const BinaryOutputStream = Components.Constructor("@mozilla.org/binaryoutputstream;1", "nsIBinaryOutputStream", "setOutputStream");

function isCatchall(v)
{
  // bug 1249474 made this be */* exactly, but bug 1711622
  // reverted to previous spec-conforming behaviour.
  // "image/*" item exactly or with a quality factor
  return /^image\/\*(?:|;q=(?:1(?:\.0{0,3})?|0(?:\.\d{0,3})?))$/.test(v);
}

/*
# Python used to generate the following byte array
def toHex(n):
  if n < 16: return "0x" + hex(n)[2:].upper()
  return "0x" + hex(n)[2:].upper()

def hexFile(name):
  f = open(name, "rb")
  try:
    while True:
      print toHex(ord(f.read(1))) + ", ",
  except:
    pass

hexFile("image/test/reftest/generic/green.png")
*/

const IMAGE_DATA =
  [
   0x89,  0x50,  0x4E,  0x47,  0x0D,  0x0A,  0x1A,  0x0A,  0x00,  0x00,  0x00,
   0x0D,  0x49,  0x48,  0x44,  0x52,  0x00,  0x00,  0x00,  0x64,  0x00,  0x00,
   0x00,  0x64,  0x08,  0x02,  0x00,  0x00,  0x00,  0xFF,  0x80,  0x02,  0x03,
   0x00,  0x00,  0x00,  0x01,  0x73,  0x52,  0x47,  0x42,  0x00,  0xAE,  0xCE,
   0x1C,  0xE9,  0x00,  0x00,  0x00,  0x9E,  0x49,  0x44,  0x41,  0x54,  0x78,
   0xDA,  0xED,  0xD0,  0x31,  0x01,  0x00,  0x00,  0x08,  0x03,  0xA0,  0x69,
   0xFF,  0xCE,  0x5A,  0xC1,  0xCF,  0x07,  0x22,  0x50,  0x99,  0x70,  0xD4,
   0x0A,  0x64,  0xC9,  0x92,  0x25,  0x4B,  0x96,  0x2C,  0x05,  0xB2,  0x64,
   0xC9,  0x92,  0x25,  0x4B,  0x96,  0x02,  0x59,  0xB2,  0x64,  0xC9,  0x92,
   0x25,  0x4B,  0x81,  0x2C,  0x59,  0xB2,  0x64,  0xC9,  0x92,  0xA5,  0x40,
   0x96,  0x2C,  0x59,  0xB2,  0x64,  0xC9,  0x52,  0x20,  0x4B,  0x96,  0x2C,
   0x59,  0xB2,  0x64,  0x29,  0x90,  0x25,  0x4B,  0x96,  0x2C,  0x59,  0xB2,
   0x14,  0xC8,  0x92,  0x25,  0x4B,  0x96,  0x2C,  0x59,  0x0A,  0x64,  0xC9,
   0x92,  0x25,  0x4B,  0x96,  0x2C,  0x05,  0xB2,  0x64,  0xC9,  0x92,  0x25,
   0x4B,  0x96,  0x02,  0x59,  0xB2,  0x64,  0xC9,  0x92,  0x25,  0x4B,  0x81,
   0x2C,  0x59,  0xB2,  0x64,  0xC9,  0x92,  0xA5,  0x40,  0x96,  0x2C,  0x59,
   0xB2,  0x64,  0xC9,  0x52,  0x20,  0x4B,  0x96,  0x2C,  0x59,  0xB2,  0x64,
   0x29,  0x90,  0x25,  0x4B,  0x96,  0x2C,  0x59,  0xB2,  0x14,  0xC8,  0x92,
   0x25,  0x4B,  0x96,  0x2C,  0x59,  0x0A,  0x64,  0xC9,  0xFA,  0xB6,  0x89,
   0x5F,  0x01,  0xC7,  0x24,  0x83,  0xB2,  0x0C,  0x00,  0x00,  0x00,  0x00,
   0x49,  0x45,  0x4E,  0x44,  0xAE,  0x42,  0x60,  0x82,
  ];

function handleRequest(request, response)
{
  response.setHeader("Content-Type", "text/plain", false);
  response.setHeader("Cache-Control", "no-cache", false);

  var accept = request.hasHeader("Accept")
             ? request.getHeader("Accept")
             : "";

  if (accept.split(",").some(isCatchall))
  {
    response.setHeader("Content-Type", "image/png", false);

    var stream = new BinaryOutputStream(response.bodyOutputStream);
    stream.writeByteArray(IMAGE_DATA);
  }
  else
  {
    response.setStatusLine(request.httpVersion, 404, "Not found");
    response.write("Accept header contained: " + accept);
  }
}
