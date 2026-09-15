from pydantic import BaseModel


class SerialPortInfo(BaseModel):
    port: str
    device: str
    description: str
    manufacturer: str | None = None
    hwid: str | None = None
    is_current: bool = False
