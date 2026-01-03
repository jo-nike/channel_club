from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    port: int = 8001
    dispatcharr_url: str = "http://10.8.0.2:9191"
    stream_base_url: str = "https://streams.domain.com"
    jwt_secret: str = "dev-secret-change-in-production"
    admin_username: str = "admin"
    admin_password: str = "admin"
    viewer_username: str = "viewer"
    viewer_password: str = "viewer"

    # ErsatzTV Configuration
    ersatztv_m3u_url: str = "http://192.168.50.108:8409/iptv/channels.m3u8"
    ersatztv_xmltv_url: str = "http://192.168.50.108:8409/iptv/xmltv.xml"
    ersatztv_base_url: str = "http://192.168.50.108:8409"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
