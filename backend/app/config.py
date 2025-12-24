from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    dispatcharr_url: str = "http://10.8.0.2:9191"
    jwt_secret: str = "dev-secret-change-in-production"
    admin_username: str = "admin"
    admin_password: str = "admin"
    viewer_username: str = "viewer"
    viewer_password: str = "viewer"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
