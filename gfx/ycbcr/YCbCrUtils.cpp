/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/EndianUtils.h"
#include "gfx2DGlue.h"
#include "mozilla/gfx/Swizzle.h"

#include "YCbCrUtils.h"
#include "yuv_convert.h"
#include "ycbcr_to_rgb565.h"
#include "libyuv.h"

namespace mozilla {
namespace gfx {

// clang-format off

static YUVType GetYUVType(const layers::PlanarYCbCrData& aData) {
  switch (aData.mChromaSubsampling) {
    case ChromaSubsampling::FULL:
      return aData.mCbCrStride > 0 ? YV24 : Y8;
    case ChromaSubsampling::HALF_WIDTH:
      return YV16;
    case ChromaSubsampling::HALF_WIDTH_AND_HEIGHT:
      return YV12;
  }
  MOZ_CRASH("Unknown chroma subsampling");
}

void
GetYCbCrToRGBDestFormatAndSize(const layers::PlanarYCbCrData& aData,
                               SurfaceFormat& aSuggestedFormat,
                               IntSize& aSuggestedSize)
{
  YUVType yuvtype = GetYUVType(aData);

  // 'prescale' is true if the scaling is to be done as part of the
  // YCbCr to RGB conversion rather than on the RGB data when rendered.
  bool prescale = aSuggestedSize.width > 0 && aSuggestedSize.height > 0 &&
                  aSuggestedSize != aData.mPictureRect.Size();

  if (aSuggestedFormat == SurfaceFormat::R5G6B5_UINT16) {
#if defined(HAVE_YCBCR_TO_RGB565)
    if (prescale &&
        !IsScaleYCbCrToRGB565Fast(aData.mPictureRect.x,
                                  aData.mPictureRect.y,
                                  aData.mPictureRect.width,
                                  aData.mPictureRect.height,
                                  aSuggestedSize.width,
                                  aSuggestedSize.height,
                                  yuvtype,
                                  FILTER_BILINEAR) &&
        IsConvertYCbCrToRGB565Fast(aData.mPictureRect.x,
                                   aData.mPictureRect.y,
                                   aData.mPictureRect.width,
                                   aData.mPictureRect.height,
                                   yuvtype)) {
      prescale = false;
    }
#else
    // yuv2rgb16 function not available
    aSuggestedFormat = SurfaceFormat::B8G8R8X8;
#endif
  }
  else if (aSuggestedFormat != SurfaceFormat::B8G8R8X8) {
    // No other formats are currently supported.
    aSuggestedFormat = SurfaceFormat::B8G8R8X8;
  }
  if (aSuggestedFormat == SurfaceFormat::B8G8R8X8) {
    /* ScaleYCbCrToRGB32 does not support a picture offset, nor 4:4:4 data.
     See bugs 639415 and 640073. */
    if (aData.mPictureRect.TopLeft() != IntPoint(0, 0) || yuvtype == YV24)
      prescale = false;
  }
  if (!prescale) {
    aSuggestedSize = aData.mPictureRect.Size();
  }
}

static inline void
ConvertYCbCr16to8Line(uint8_t* aDst,
                      int aStride,
                      const uint16_t* aSrc,
                      int aStride16,
                      int aWidth,
                      int aHeight,
                      int aBitDepth)
{
  // These values from from the comment on from libyuv's Convert16To8Row_C:
  int scale;
  switch (aBitDepth) {
    case 10:
      scale = 16384;
      break;
    case 12:
      scale = 4096;
      break;
    case 16:
      scale = 256;
      break;
    default:
      MOZ_ASSERT_UNREACHABLE("invalid bit depth value");
      return;
  }

  libyuv::Convert16To8Plane(aSrc, aStride16, aDst, aStride, scale, aWidth, aHeight);
}

void
ConvertYCbCrToRGBInternal(const layers::PlanarYCbCrData& aData,
                          const SurfaceFormat& aDestFormat,
                          const IntSize& aDestSize,
                          unsigned char* aDestBuffer,
                          int32_t aStride)
{
  // ConvertYCbCrToRGB et al. assume the chroma planes are rounded up if the
  // luma plane is odd sized. Monochrome images have 0-sized CbCr planes
  YUVType yuvtype = GetYUVType(aData);

  // Used if converting to 8 bits YUV.
  UniquePtr<uint8_t[]> yChannel;
  UniquePtr<uint8_t[]> cbChannel;
  UniquePtr<uint8_t[]> crChannel;
  layers::PlanarYCbCrData dstData;
  const layers::PlanarYCbCrData& srcData =
    aData.mColorDepth == ColorDepth::COLOR_8 ? aData : dstData;

  if (aData.mColorDepth != ColorDepth::COLOR_8) {
    // Convert to 8 bits data first.
    dstData.mPictureRect = aData.mPictureRect;
    // We align the destination stride to 32 bytes, so that libyuv can use
    // SSE optimised code.
    auto ySize = aData.YDataSize();
    auto cbcrSize = aData.CbCrDataSize();
    dstData.mYStride = (ySize.width + 31) & ~31;
    dstData.mCbCrStride = (cbcrSize.width + 31) & ~31;
    dstData.mYUVColorSpace = aData.mYUVColorSpace;
    dstData.mColorDepth = ColorDepth::COLOR_8;
    dstData.mColorRange = aData.mColorRange;
    dstData.mChromaSubsampling = aData.mChromaSubsampling;

    size_t yMemorySize = GetAlignedStride<1>(dstData.mYStride, ySize.height);
    size_t cbcrMemorySize =
      GetAlignedStride<1>(dstData.mCbCrStride, cbcrSize.height);
    if (yMemorySize == 0) {
      MOZ_DIAGNOSTIC_ASSERT(cbcrMemorySize == 0, "CbCr without Y makes no sense");
      return;
    }
    yChannel = MakeUnique<uint8_t[]>(yMemorySize);

    dstData.mYChannel = yChannel.get();

    int bitDepth = BitDepthForColorDepth(aData.mColorDepth);

    ConvertYCbCr16to8Line(dstData.mYChannel,
                          dstData.mYStride,
                          reinterpret_cast<uint16_t*>(aData.mYChannel),
                          aData.mYStride / 2,
                          ySize.width,
                          ySize.height,
                          bitDepth);

    if (cbcrMemorySize) {
      cbChannel = MakeUnique<uint8_t[]>(cbcrMemorySize);
      crChannel = MakeUnique<uint8_t[]>(cbcrMemorySize);

      dstData.mCbChannel = cbChannel.get();
      dstData.mCrChannel = crChannel.get();

      ConvertYCbCr16to8Line(dstData.mCbChannel,
                            dstData.mCbCrStride,
                            reinterpret_cast<uint16_t*>(aData.mCbChannel),
                            aData.mCbCrStride / 2,
                            cbcrSize.width,
                            cbcrSize.height,
                            bitDepth);

      ConvertYCbCr16to8Line(dstData.mCrChannel,
                            dstData.mCbCrStride,
                            reinterpret_cast<uint16_t*>(aData.mCrChannel),
                            aData.mCbCrStride / 2,
                            cbcrSize.width,
                            cbcrSize.height,
                            bitDepth);
    }
  }

  // Convert from YCbCr to RGB now, scaling the image if needed.
  if (aDestSize != srcData.mPictureRect.Size()) {
#if defined(HAVE_YCBCR_TO_RGB565)
    if (aDestFormat == SurfaceFormat::R5G6B5_UINT16) {
      ScaleYCbCrToRGB565(srcData.mYChannel,
                         srcData.mCbChannel,
                         srcData.mCrChannel,
                         aDestBuffer,
                         srcData.mPictureRect.x,
                         srcData.mPictureRect.y,
                         srcData.mPictureRect.width,
                         srcData.mPictureRect.height,
                         aDestSize.width,
                         aDestSize.height,
                         srcData.mYStride,
                         srcData.mCbCrStride,
                         aStride,
                         yuvtype,
                         FILTER_BILINEAR);
    } else
#endif
      ScaleYCbCrToRGB32(srcData.mYChannel, //
                        srcData.mCbChannel,
                        srcData.mCrChannel,
                        aDestBuffer,
                        srcData.mPictureRect.width,
                        srcData.mPictureRect.height,
                        aDestSize.width,
                        aDestSize.height,
                        srcData.mYStride,
                        srcData.mCbCrStride,
                        aStride,
                        yuvtype,
                        srcData.mYUVColorSpace,
                        FILTER_BILINEAR);
  } else { // no prescale
#if defined(HAVE_YCBCR_TO_RGB565)
    if (aDestFormat == SurfaceFormat::R5G6B5_UINT16) {
      ConvertYCbCrToRGB565(srcData.mYChannel,
                           srcData.mCbChannel,
                           srcData.mCrChannel,
                           aDestBuffer,
                           srcData.mPictureRect.x,
                           srcData.mPictureRect.y,
                           srcData.mPictureRect.width,
                           srcData.mPictureRect.height,
                           srcData.mYStride,
                           srcData.mCbCrStride,
                           aStride,
                           yuvtype);
    } else // aDestFormat != SurfaceFormat::R5G6B5_UINT16
#endif
      ConvertYCbCrToRGB32(srcData.mYChannel, //
                          srcData.mCbChannel,
                          srcData.mCrChannel,
                          aDestBuffer,
                          srcData.mPictureRect.x,
                          srcData.mPictureRect.y,
                          srcData.mPictureRect.width,
                          srcData.mPictureRect.height,
                          srcData.mYStride,
                          srcData.mCbCrStride,
                          aStride,
                          yuvtype,
                          srcData.mYUVColorSpace,
                          srcData.mColorRange);
  }
}

void ConvertYCbCrToRGB(const layers::PlanarYCbCrData& aData,
                       const SurfaceFormat& aDestFormat,
                       const IntSize& aDestSize, unsigned char* aDestBuffer,
                       int32_t aStride) {
  ConvertYCbCrToRGBInternal(aData, aDestFormat, aDestSize, aDestBuffer,
                            aStride);
#if MOZ_BIG_ENDIAN()
  // libyuv makes endian-correct result, which needs to be swapped to BGRX
  if (aDestFormat != SurfaceFormat::R5G6B5_UINT16) {
    gfx::SwizzleData(aDestBuffer, aStride, gfx::SurfaceFormat::X8R8G8B8,
                     aDestBuffer, aStride, gfx::SurfaceFormat::B8G8R8X8,
                     aDestSize);
  }
#endif
}

void FillAlphaToRGBA(const uint8_t* aAlpha, const int32_t aAlphaStride,
                     uint8_t* aBuffer, const int32_t aWidth,
                     const int32_t aHeight, const gfx::SurfaceFormat& aFormat) {
  MOZ_ASSERT(aAlphaStride >= aWidth);
  MOZ_ASSERT(aFormat ==
             SurfaceFormat::B8G8R8A8);  // required for SurfaceFormatBit::OS_A

  const int bpp = BytesPerPixel(aFormat);
  const size_t rgbaStride = aWidth * bpp;
  const uint8_t* src = aAlpha;
  for (int32_t h = 0; h < aHeight; ++h) {
    size_t offset = static_cast<size_t>(SurfaceFormatBit::OS_A) / 8;
    for (int32_t w = 0; w < aWidth; ++w) {
      aBuffer[offset] = src[w];
      offset += bpp;
    }
    src += aAlphaStride;
    aBuffer += rgbaStride;
  }
}

void ConvertYCbCrAToARGB(const layers::PlanarYCbCrData& aYCbCr,
                         const layers::PlanarAlphaData& aAlpha,
                         const SurfaceFormat& aDestFormat,
                         const IntSize& aDestSize, unsigned char* aDestBuffer,
                         int32_t aStride, PremultFunc premultiplyAlphaOp) {
  // libyuv makes endian-correct result, so the format needs to be B8G8R8A8.
  MOZ_ASSERT(aDestFormat == SurfaceFormat::B8G8R8A8);
  MOZ_ASSERT(aAlpha.mSize == aYCbCr.YDataSize());

  // libyuv has libyuv::I420AlphaToARGB, but lacks support for 422 and 444.
  // Until that's added, we'll rely on our own code to handle this more
  // generally, rather than have a special case and more redundant code.

  UniquePtr<uint8_t[]> alphaChannel;
  int32_t alphaStride8bpp = 0;
  uint8_t* alphaChannel8bpp = nullptr;

  // This function converts non-8-bpc images to 8-bpc. (Bug 1682322)
  ConvertYCbCrToRGBInternal(aYCbCr, aDestFormat, aDestSize, aDestBuffer,
                            aStride);

  if (aYCbCr.mColorDepth != ColorDepth::COLOR_8) {
    // These two lines are borrowed from ConvertYCbCrToRGBInternal, since
    // there's not a very elegant way of sharing the logic that I can see
    alphaStride8bpp = (aAlpha.mSize.width + 31) & ~31;
    size_t alphaSize =
        GetAlignedStride<1>(alphaStride8bpp, aAlpha.mSize.height);

    alphaChannel = MakeUnique<uint8_t[]>(alphaSize);

    ConvertYCbCr16to8Line(alphaChannel.get(), alphaStride8bpp,
                          reinterpret_cast<uint16_t*>(aAlpha.mChannel),
                          aYCbCr.mYStride / 2, aAlpha.mSize.width,
                          aAlpha.mSize.height,
                          BitDepthForColorDepth(aYCbCr.mColorDepth));

    alphaChannel8bpp = alphaChannel.get();
  } else {
    alphaStride8bpp = aYCbCr.mYStride;
    alphaChannel8bpp = aAlpha.mChannel;
  }

  MOZ_ASSERT(alphaStride8bpp != 0);
  MOZ_ASSERT(alphaChannel8bpp);

  FillAlphaToRGBA(alphaChannel8bpp, alphaStride8bpp, aDestBuffer,
                  aYCbCr.mPictureRect.width, aYCbCr.mPictureRect.height, aDestFormat);

  if (premultiplyAlphaOp) {
    DebugOnly<int> err =
        premultiplyAlphaOp(aDestBuffer, aStride, aDestBuffer, aStride,
                           aYCbCr.mPictureRect.width, aYCbCr.mPictureRect.height);
    MOZ_ASSERT(!err);
  }

#if MOZ_BIG_ENDIAN()
  // libyuv makes endian-correct result, which needs to be swapped to BGRA
  gfx::SwizzleData(aDestBuffer, aStride, gfx::SurfaceFormat::A8R8G8B8,
                   aDestBuffer, aStride, gfx::SurfaceFormat::B8G8R8A8,
                   aYCbCr.mPictureRect.Size());
#endif
}

void
ConvertI420AlphaToARGB(const uint8_t* aSrcY,
                       const uint8_t* aSrcU,
                       const uint8_t* aSrcV,
                       const uint8_t* aSrcA,
                       int aSrcStrideYA, int aSrcStrideUV,
                       uint8_t* aDstARGB, int aDstStrideARGB,
                       int aWidth, int aHeight) {

  ConvertI420AlphaToARGB32(aSrcY,
                           aSrcU,
                           aSrcV,
                           aSrcA,
                           aDstARGB,
                           aWidth,
                           aHeight,
                           aSrcStrideYA,
                           aSrcStrideUV,
                           aDstStrideARGB);
#if MOZ_BIG_ENDIAN()
  // libyuv makes endian-correct result, which needs to be swapped to BGRA
  gfx::SwizzleData(aDstARGB, aDstStrideARGB, gfx::SurfaceFormat::A8R8G8B8,
                   aDstARGB, aDstStrideARGB, gfx::SurfaceFormat::B8G8R8A8,
                   IntSize(aWidth, aHeight));
#endif
}

} // namespace gfx
} // namespace mozilla
