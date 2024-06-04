# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import io
import os
import sys
from datetime import datetime

import buildconfig
from mozbuild.preprocessor import Preprocessor

TEMPLATE = """
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

#include<winuser.h>
#include<winver.h>

// Note: if you contain versioning information in an included
// RC script, it will be discarded
// Use module.ver to explicitly set these values

// Do not edit this file. Changes won't affect the build.

{include}

Identity LimitedAccessFeature {{ L"{lafidentity}_pcsmm0jrprpb2" }}


/////////////////////////////////////////////////////////////////////////////
//
// Version
//

1 VERSIONINFO
 FILEVERSION    {fileversion}
 PRODUCTVERSION {productversion}
 FILEFLAGSMASK 0x3fL
 FILEFLAGS {fileflags}
 FILEOS VOS__WINDOWS32
 FILETYPE VFT_DLL
 FILESUBTYPE 0x0L
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "000004b0"
        BEGIN
            VALUE "Comments", "{comment}"
            VALUE "LegalCopyright", "{copyright}"
            VALUE "CompanyName", "{company}"
            VALUE "FileDescription", "{description}"
            VALUE "FileVersion", "{mfversion}"
            VALUE "ProductVersion", "{mpversion}"
            VALUE "InternalName", "{module}"
            VALUE "LegalTrademarks", "{trademarks}"
            VALUE "OriginalFilename", "{binary}"
            VALUE "ProductName", "{productname}"
            VALUE "BuildID", "{buildid}"
        END
    END
    BLOCK "VarFileInfo"
    BEGIN
        VALUE "Translation", 0x0, 1200
    END
END

"""


class SystemClockDiscrepancy(Exception):
    """Represents an error encountered during the build when determining delta between the build time and
    the commit time of milestone.txt via VCS."""


def preprocess(path, defines):
    pp = Preprocessor(defines=defines, marker="%")
    pp.context.update(defines)
    pp.out = io.StringIO()
    pp.do_filter("substitution")
    pp.do_include(io.open(path, "r", encoding="latin1"))
    pp.out.seek(0)
    return pp.out


def parse_module_ver(path, defines):
    result = {}
    for line in preprocess(path, defines):
        content, *comment = line.split("#", 1)
        if not content.strip():
            continue
        entry, value = content.split("=", 1)
        result[entry.strip()] = value.strip()
    return result


def get_buildid():
    path = os.path.join(buildconfig.topobjdir, "buildid.h")
    define, MOZ_BUILDID, buildid = io.open(path, "r", encoding="utf-8").read().split()
    return buildid


def last_winversion_segment(buildid, app_version_display):
    """
    The last segment needs to fit into a 16 bit number. We also need to
    encode what channel this version is from. We'll do this by using 2 bits
    to encode the channel, and 14 bits to encode the number of hours since
    the 'config/milestone.txt' was modified (relative to the build time).

    This gives us about ~682 days of release hours that will yield a unique
    file version for a specific channel/milestone combination. This should suffice
    since the main problem we're trying to address is uniqueness in CI for a
    channel/milestone over about a 1 month period.

    If two builds for the same channel/milestone are done in CI within the same
    hour there's still a chance for overlap and issues with AV as originally
    reported in https://bugzilla.mozilla.org/show_bug.cgi?id=1872242

    If a build is done after the ~682 day window of uniqueness, the value for
    this segment will always be the maximum value for the channel (no overflow).
    It will also always be the maximum value for the channel if a build is done
    from a source distribution, because we cannot determine the milestone date
    change without a VCS.

    If necessary, you can decode the result of this function. You just need to
    do integer division and divide it by 4. The quotient will be the delta
    between the milestone bump and the build time, and the remainder will be
    the channel digit. Refer to the if/else chain near the end of the function
    for what channels the channel digits map to.

    Example:
        Encoded: 1544

        1554 / 4 =
        Quotient: 388
        Remainder: 2 (ESR)
    """
    from mozversioncontrol import MissingVCSTool, get_repository_object

    # Max 16 bit value with 2 most significant bits as 0 (reserved so we can
    # shift later and make room for the channel digit).
    MAX_VALUE = 0x3FFF

    try:
        import time
        from datetime import timedelta, timezone
        from pathlib import Path

        topsrcdir = buildconfig.topsrcdir
        repo = get_repository_object(topsrcdir)

        milestone_time = repo.get_last_modified_time_for_file(
            Path(topsrcdir) / "config" / "milestone.txt"
        )
        # The buildid doesn't include timezone info, but the milestone_time does.
        # We're building on this machine, so we just need the system local timezone
        # added to a buildid constructed datetime object to make a valid comparison.
        local_tz = timezone(timedelta(seconds=time.timezone))
        buildid_time = datetime.strptime(buildid, "%Y%m%d%H%M%S").replace(
            tzinfo=local_tz
        )

        time_delta = buildid_time - milestone_time
        # If the time delta is negative it means that the system clock on the build machine is
        # significantly far ahead. If we're in CI we'll raise an error, since this number mostly
        # only matters for doing releases in CI. If we're not in CI, we'll just set the value to
        # the maximum instead of needlessly interrupting the build of a user with fast/intentionally
        # modified system clock.
        if time_delta.total_seconds() < 0:
            if "MOZ_AUTOMATION" in os.environ:
                raise SystemClockDiscrepancy(
                    f"The system clock is ahead of the milestone.txt commit time "
                    f"by at least {int(time_delta.total_seconds())} seconds (Since "
                    f"the milestone commit must come before the build starts). This "
                    f"is a problem because use a relative time difference to determine the"
                    f"file_version (and it can't be negative), so we cannot proceed. \n\n"
                    f"Please ensure the system clock is correct."
                )
            else:
                hours_from_milestone_date = MAX_VALUE
        else:
            # Convert from seconds to hours
            # When a build is done more than ~682 days in the future, we can't represent the value.
            # We'll always set the value to the maximum value instead of overflowing.
            hours_from_milestone_date = min(
                int(time_delta.total_seconds() / 3600), MAX_VALUE
            )
    except MissingVCSTool:
        # If we're here we can't use the VCS to determine the time differential, so
        # we'll just set it to the maximum value instead of doing something weird.
        hours_from_milestone_date = MAX_VALUE
        pass

    if buildconfig.substs.get("NIGHTLY_BUILD"):
        # Nightly
        channel_digit = 0
    elif "b" in app_version_display:
        # Beta
        channel_digit = 1
    elif buildconfig.substs.get("MOZ_ESR"):
        # ESR
        channel_digit = 2
    else:
        # Release
        channel_digit = 3
    # left shift to make room to encode the channel digit
    return str((hours_from_milestone_date << 2) + channel_digit)


def digits_only(s):
    for l in range(len(s), 0, -1):
        if s[:l].isdigit():
            return s[:l]
    return "0"


def split_and_normalize_version(version, len):
    return ([digits_only(x) for x in version.split(".")] + ["0"] * len)[:len]


def has_manifest(module_rc, manifest_id):
    for lineFromInput in module_rc.splitlines():
        line = lineFromInput.split(None, 2)
        if len(line) < 2:
            continue
        id, what, *rest = line
        if id == manifest_id and what in ("24", "RT_MANIFEST"):
            return True
    return False


def generate_module_rc(binary="", rcinclude=None):
    deps = set()
    buildid = get_buildid()
    milestone = buildconfig.substs["GRE_MILESTONE"]
    app_version = buildconfig.substs.get("MOZ_APP_VERSION") or milestone
    app_version_display = buildconfig.substs.get("MOZ_APP_VERSION_DISPLAY")
    app_winversion = ",".join(split_and_normalize_version(app_version, 4))
    milestone_winversion = ",".join(
        split_and_normalize_version(milestone, 3)
        + [last_winversion_segment(buildid, app_version_display)]
    )
    display_name = buildconfig.substs.get("MOZ_APP_DISPLAYNAME", "Mozilla")

    milestone_string = milestone

    flags = ["0"]
    if buildconfig.substs.get("MOZ_DEBUG"):
        flags.append("VS_FF_DEBUG")
        milestone_string += " Debug"
    if not buildconfig.substs.get("MOZILLA_OFFICIAL"):
        flags.append("VS_FF_PRIVATEBUILD")
    if buildconfig.substs.get("NIGHTLY_BUILD"):
        flags.append("VS_FF_PRERELEASE")

    defines = {
        "MOZ_APP_DISPLAYNAME": display_name,
        "MOZ_APP_VERSION": app_version,
        "MOZ_APP_WINVERSION": app_winversion,
    }

    relobjdir = os.path.relpath(".", buildconfig.topobjdir)
    srcdir = os.path.join(buildconfig.topsrcdir, relobjdir)
    module_ver = os.path.join(srcdir, "module.ver")
    if os.path.exists(module_ver):
        deps.add(module_ver)
        overrides = parse_module_ver(module_ver, defines)
    else:
        overrides = {}

    if rcinclude:
        include = "// From included resource {}\n{}".format(
            rcinclude, preprocess(rcinclude, defines).read()
        )
    else:
        include = ""

    # Set the identity field for the Limited Access Feature
    # Must match the tokens used in Win11LimitedAccessFeatures.cpp
    lafidentity = "MozillaFirefox"
    # lafidentity = "FirefoxBeta"
    # lafidentity = "FirefoxNightly"

    data = TEMPLATE.format(
        include=include,
        lafidentity=lafidentity,
        fileversion=overrides.get("WIN32_MODULE_FILEVERSION", milestone_winversion),
        productversion=overrides.get(
            "WIN32_MODULE_PRODUCTVERSION", milestone_winversion
        ),
        fileflags=" | ".join(flags),
        comment=overrides.get("WIN32_MODULE_COMMENT", ""),
        copyright=overrides.get("WIN32_MODULE_COPYRIGHT", "License: MPL 2"),
        company=overrides.get("WIN32_MODULE_COMPANYNAME", "Mozilla Foundation"),
        description=overrides.get("WIN32_MODULE_DESCRIPTION", ""),
        mfversion=overrides.get("WIN32_MODULE_FILEVERSION_STRING", milestone_string),
        mpversion=overrides.get("WIN32_MODULE_PRODUCTVERSION_STRING", milestone_string),
        module=overrides.get("WIN32_MODULE_NAME", ""),
        trademarks=overrides.get("WIN32_MODULE_TRADEMARKS", "Mozilla"),
        binary=overrides.get("WIN32_MODULE_ORIGINAL_FILENAME", binary),
        productname=overrides.get("WIN32_MODULE_PRODUCTNAME", display_name),
        buildid=buildid,
    )

    manifest_id = "2" if binary.lower().endswith(".dll") else "1"
    if binary and not has_manifest(data, manifest_id):
        manifest_path = os.path.join(srcdir, binary + ".manifest")
        if os.path.exists(manifest_path):
            manifest_path = manifest_path.replace("\\", "\\\\")
            data += '\n{} RT_MANIFEST "{}"\n'.format(manifest_id, manifest_path)

    with io.open("{}.rc".format(binary or "module"), "w", encoding="latin1") as fh:
        fh.write(data)


if __name__ == "__main__":
    generate_module_rc(*sys.argv[1:])
