from pydantic import BaseModel


class SerialPortInfo(BaseModel):
    port: str
    description: str
    manufacturer: str | None = None
    hwid: str | None = None
