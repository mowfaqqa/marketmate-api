import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import { digest } from "../auth/security";

export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

export async function prepareImage(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_BYTES)
    throw new BadRequestException(
      "Choose a JPEG, PNG or WebP image up to 10 MB.",
    );
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP";
  if (!jpeg && !png && !webp)
    throw new BadRequestException(
      "This file is not a supported JPEG, PNG or WebP image.",
    );
  try {
    const image = sharp(buffer, {
      limitInputPixels: MAX_PIXELS,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_PIXELS ||
      (metadata.pages || 1) > 1
    )
      throw new Error("Invalid dimensions or animation.");
    const full = await image
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .timeout({ seconds: 15 })
      .toBuffer({ resolveWithObject: true });
    const preview = await sharp(full.data)
      .resize({
        width: 480,
        height: 480,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      content: full.data,
      preview,
      width: full.info.width,
      height: full.info.height,
      bytes: full.data.length,
      checksum: digest(full.data),
    };
  } catch {
    throw new BadRequestException(
      "The photo could not be read. Use a still JPEG, PNG or WebP up to 20 megapixels.",
    );
  }
}
