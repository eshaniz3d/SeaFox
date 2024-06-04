#!/usr/bin/env python3

import json


def generate(output, *input_paths):
    """
    This file generates a ThirdPartyPaths.cpp file from the ThirdPartyPaths.txt
    file in /tools/rewriting, which is used by the Clang Plugin to help identify
    sources which should be ignored.
    """
    tpp_list = []
    lines = set()

    for path in input_paths:
        with open(path) as f:
            lines.update(f.readlines())

    for line in lines:
        line = line.strip()
        if line.endswith("/"):
            line = line[:-1]
        tpp_list.append(line)
    tpp_strings = ",\n  ".join([json.dumps(tpp) for tpp in sorted(tpp_list)])

    output.write(
        """\
/* THIS FILE IS GENERATED BY ThirdPartyPaths.py - DO NOT EDIT */

#include <stdint.h>

const char* MOZ_THIRD_PARTY_PATHS[] = {
  %s
};

extern const uint32_t MOZ_THIRD_PARTY_PATHS_COUNT = %d;

"""
        % (tpp_strings, len(tpp_list))
    )
