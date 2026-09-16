// Service errors shared by Web and Electron versions.

export class ServiceError extends Error {
  code = "SERVICE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export class WebSerialUnsupportedError extends ServiceError {
  code = "WEB_SERIAL_UNSUPPORTED";
  constructor() {
    super(
      "当前浏览器不支持 Web Serial API，请使用 Chrome 或 Edge (89+) 并通过 https 或 localhost 访问",
    );
    this.name = "WebSerialUnsupportedError";
  }
}

export class SerialUserCancelledError extends ServiceError {
  code = "SERIAL_USER_CANCELLED";
  constructor() {
    super("已取消串口选择");
    this.name = "SerialUserCancelledError";
  }
}

export class SerialPortNotFoundError extends ServiceError {
  code = "SERIAL_PORT_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "SerialPortNotFoundError";
  }
}

export class PortBusyError extends ServiceError {
  code = "SERIAL_PORT_BUSY";
  constructor(message: string) {
    super(message);
    this.name = "PortBusyError";
  }
}

export class SerialConnectionError extends ServiceError {
  code = "SERIAL_CONNECTION_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "SerialConnectionError";
  }
}

export class SerialNotConnectedError extends ServiceError {
  code = "SERIAL_NOT_CONNECTED";
  constructor(message: string) {
    super(message);
    this.name = "SerialNotConnectedError";
  }
}

export class SerialWriteError extends ServiceError {
  code = "SERIAL_WRITE_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "SerialWriteError";
  }
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ServiceError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "发生未知错误";
}
