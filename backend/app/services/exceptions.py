class ServiceError(Exception):
    """Base class for errors that can be returned safely through the API."""

    code = "SERVICE_ERROR"
    status_code = 500

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class SerialPortScanError(ServiceError):
    code = "SERIAL_PORT_SCAN_FAILED"
    status_code = 500


class PortNotFoundError(ServiceError):
    code = "SERIAL_PORT_NOT_FOUND"
    status_code = 404


class PortBusyError(ServiceError):
    code = "SERIAL_PORT_BUSY"
    status_code = 409


class SerialAlreadyConnectedError(ServiceError):
    code = "SERIAL_ALREADY_CONNECTED"
    status_code = 409


class SerialConnectionError(ServiceError):
    code = "SERIAL_CONNECTION_FAILED"
    status_code = 502


class SerialNotConnectedError(ServiceError):
    code = "SERIAL_NOT_CONNECTED"
    status_code = 409


class SerialWriteError(ServiceError):
    code = "SERIAL_WRITE_FAILED"
    status_code = 502


class RelayStateUnknownError(ServiceError):
    code = "RELAY_STATE_UNKNOWN"
    status_code = 409
