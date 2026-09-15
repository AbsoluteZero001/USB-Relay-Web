from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration with safe LCUS-1 defaults."""

    app_name: str = "USB Relay Web"
    api_prefix: str = "/api"
    debug: bool = False

    default_serial_port: str | None = None
    serial_baudrate: int = 9600
    serial_timeout: float = 1.0
    serial_write_timeout: float = 2.0

    cors_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="USB_RELAY_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
