export class HexValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HexValidationError";
  }
}

interface ParseHexOptions {
  allowEmpty?: boolean;
}

export function formatHexBytes(bytes: number[]): string {
  return bytes
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

export function parseHexBytes(
  value: string | number[] | null | undefined,
  options: ParseHexOptions = {},
): number[] {
  const allowEmpty = options.allowEmpty ?? false;

  if (Array.isArray(value)) {
    if (value.length === 0 && allowEmpty) {
      return [];
    }
    if (value.length === 0) {
      throw new HexValidationError("HEX 指令不能为空");
    }
    for (const byte of value) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
        throw new HexValidationError(`HEX 字节超出范围：${byte}`);
      }
    }
    return [...value];
  }

  const text = value?.trim() ?? "";
  if (!text) {
    if (allowEmpty) {
      return [];
    }
    throw new HexValidationError("HEX 指令不能为空");
  }

  const invalidCharacter = text.match(/[^0-9a-fA-F\s]/)?.[0];
  if (invalidCharacter) {
    throw new HexValidationError(`HEX 指令包含非法字符：${invalidCharacter}`);
  }

  const compact = text.replace(/\s+/g, "");
  if (compact.length % 2 !== 0) {
    throw new HexValidationError(
      "HEX 指令必须由完整字节组成，字符数量不能为奇数",
    );
  }

  const bytes: number[] = [];
  for (let index = 0; index < compact.length; index += 2) {
    const byteText = compact.slice(index, index + 2);
    const byte = Number.parseInt(byteText, 16);
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      throw new HexValidationError(`HEX 字节不合法：${byteText}`);
    }
    bytes.push(byte);
  }
  return bytes;
}

export function tryParseHexBytes(
  value: string | number[] | null | undefined,
  options: ParseHexOptions = {},
): number[] | null {
  try {
    return parseHexBytes(value, options);
  } catch {
    return null;
  }
}
