# Story 7.1: ErsatzTV Configuration & Models

Status: review

## Story

As a developer,
I want ErsatzTV configuration and data models in place,
so that I can build services that interact with ErsatzTV.

## Acceptance Criteria

1. **Configuration**: ErsatzTV environment variables accessible via `settings.ersatztv_m3u_url`, `settings.ersatztv_xmltv_url`, and `settings.ersatztv_base_url`
2. **Models**: `EPGChannel` and `Programme` Pydantic models available from `app.models.ersatztv`
3. **JSON Serialization**: Models support camelCase field names for JSON responses

## Tasks / Subtasks

- [x] Task 1: Add ErsatzTV settings to config (AC: #1)
  - [x] Add `ersatztv_m3u_url`, `ersatztv_xmltv_url`, `ersatztv_base_url` to Settings class
  - [x] Provide sensible defaults for local development
- [x] Task 2: Create ErsatzTV Pydantic models (AC: #2, #3)
  - [x] Create `backend/app/models/ersatztv.py`
  - [x] Define `EPGChannel` model with id, name, stream_url, logo_url, number, group fields
  - [x] Define `Programme` model with id, channel_id, title, description, start, stop, category fields
  - [x] Define response models for API endpoints
- [x] Task 3: Add models to package exports
  - [x] Update `backend/app/models/__init__.py` with ersatztv exports
- [x] Task 4: Update .env.example with new variables
  - [x] Add ERSATZTV_M3U_URL, ERSATZTV_XMLTV_URL, ERSATZTV_BASE_URL documentation
- [x] Task 5: Write tests (AC: #1, #2, #3)
  - [x] Test settings load from environment
  - [x] Test model JSON serialization uses camelCase
  - [x] Test model validation

## Dev Notes

### Architecture Compliance

- **Config pattern**: Extend existing `backend/app/config.py` Settings class
- **Model pattern**: Follow existing models in `backend/app/models/`
- **Naming**: Use snake_case for Python, camelCase aliases for JSON
- **Path alias**: Use Field(alias="camelCase") for JSON serialization

### Technical Implementation

**Config additions** (`backend/app/config.py`):
```python
class Settings(BaseSettings):
    # ... existing settings ...

    # ErsatzTV Configuration
    ersatztv_m3u_url: str = "http://192.168.50.108:8409/iptv/channels.m3u8"
    ersatztv_xmltv_url: str = "http://192.168.50.108:8409/iptv/xmltv.xml"
    ersatztv_base_url: str = "http://192.168.50.108:8409"
```

**Models** (`backend/app/models/ersatztv.py`):
```python
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class EPGChannel(BaseModel):
    """ErsatzTV channel from M3U playlist"""
    id: str = Field(..., description="Unique channel identifier (tvg-id)")
    name: str = Field(..., description="Channel display name")
    stream_url: str = Field(alias="streamUrl", description="HLS stream URL")
    logo_url: Optional[str] = Field(default=None, alias="logoUrl", description="Channel logo URL")
    number: Optional[int] = Field(default=None, description="Channel number for ordering")
    group: Optional[str] = Field(default=None, description="Channel group/category")

    class Config:
        populate_by_name = True


class Programme(BaseModel):
    """ErsatzTV programme from XMLTV data"""
    id: str = Field(..., description="Unique programme identifier")
    channel_id: str = Field(alias="channelId", description="References EPGChannel.id")
    title: str = Field(..., description="Programme title")
    description: Optional[str] = Field(default=None, description="Programme description")
    start: datetime = Field(..., description="Start time (UTC)")
    stop: datetime = Field(..., description="End time (UTC)")
    category: Optional[List[str]] = Field(default=None, description="Programme categories")

    class Config:
        populate_by_name = True


class EPGChannelResponse(BaseModel):
    """Response for GET /api/ersatztv/channels"""
    channels: List[EPGChannel]


class CurrentProgrammeResponse(BaseModel):
    """Response for GET /api/ersatztv/current/{channel_id}"""
    channel_id: str = Field(alias="channelId")
    current: Optional[Programme] = None
    next_up: Optional[Programme] = Field(default=None, alias="nextUp")

    class Config:
        populate_by_name = True


class ProgrammeListResponse(BaseModel):
    """Response for GET /api/ersatztv/programmes/{channel_id}"""
    channel_id: str = Field(alias="channelId")
    programmes: List[Programme]

    class Config:
        populate_by_name = True
```

### Reference from Prototype

The prototype at `/home/jon/Code/iptv_viewer/app/epg/models.py` has similar models that can be referenced:
- `EPGChannel` with id, name, stream_url, logo_url, number, group
- `Programme` with id, channel_id, title, description, start, stop, category, episode metadata

### Environment Variables

Add to `.env`:
```bash
ERSATZTV_M3U_URL=http://192.168.50.108:8409/iptv/channels.m3u8
ERSATZTV_XMLTV_URL=http://192.168.50.108:8409/iptv/xmltv.xml
ERSATZTV_BASE_URL=http://192.168.50.108:8409
```

### Project Structure Notes

New/modified files:
- `backend/app/config.py` (modify)
- `backend/app/models/ersatztv.py` (new)
- `backend/app/models/__init__.py` (modify)
- `.env.example` (modify)
- `backend/app/models/ersatztv_test.py` (new)

### Testing Requirements

```python
def test_settings_loads_ersatztv_config():
    """Settings should load ErsatzTV config from environment"""
    settings = Settings()
    assert settings.ersatztv_m3u_url is not None
    assert settings.ersatztv_xmltv_url is not None
    assert settings.ersatztv_base_url is not None

def test_epg_channel_json_serialization():
    """EPGChannel should serialize to camelCase JSON"""
    channel = EPGChannel(
        id="test-1",
        name="Test Channel",
        stream_url="http://example.com/stream.m3u8"
    )
    json_data = channel.model_dump(by_alias=True)
    assert "streamUrl" in json_data
    assert "stream_url" not in json_data

def test_programme_json_serialization():
    """Programme should serialize to camelCase JSON"""
    from datetime import datetime, timezone
    prog = Programme(
        id="prog-1",
        channel_id="ch-1",
        title="Test Show",
        start=datetime.now(timezone.utc),
        stop=datetime.now(timezone.utc)
    )
    json_data = prog.model_dump(by_alias=True)
    assert "channelId" in json_data
    assert "channel_id" not in json_data
```

### References

- [Source: backend/app/config.py] - Existing Settings pattern
- [Source: backend/app/models/channel.py] - Existing model pattern
- [Source: /home/jon/Code/iptv_viewer/app/epg/models.py] - Prototype EPG models
- [Source: _bmad-output/project-context.md] - JSON camelCase convention

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded without issues.

### Completion Notes List

- **Task 1**: Added `ersatztv_m3u_url`, `ersatztv_xmltv_url`, `ersatztv_base_url` settings to `backend/app/config.py` with sensible defaults pointing to 192.168.50.108:8409.
- **Task 2**: Created `backend/app/models/ersatztv.py` with EPGChannel, Programme, EPGChannelResponse, CurrentProgrammeResponse, and ProgrammeListResponse models. All models use camelCase aliases for JSON serialization (e.g., `stream_url` → `streamUrl`, `channel_id` → `channelId`).
- **Task 3**: Updated `backend/app/models/__init__.py` to export all ersatztv models.
- **Task 4**: Updated both `backend/.env.example` and root `.env.example` with ErsatzTV configuration documentation.
- **Task 5**: Wrote comprehensive tests - 4 tests for config settings, 17 tests for model creation, validation, and JSON serialization. All 21 new tests pass.

### Change Log

- 2026-01-03: Implemented story 7.1 - ErsatzTV Configuration & Models. Added 3 settings, 5 Pydantic models, updated 2 .env.example files, created 2 test files with 21 tests.

### File List

**Modified:**
- `backend/app/config.py` - Added ErsatzTV settings (ersatztv_m3u_url, ersatztv_xmltv_url, ersatztv_base_url)
- `backend/app/models/__init__.py` - Added ersatztv model exports
- `backend/.env.example` - Added ErsatzTV configuration documentation
- `.env.example` - Added ErsatzTV configuration documentation

**New:**
- `backend/app/models/ersatztv.py` - EPGChannel, Programme, and response models
- `backend/tests/test_config.py` - Tests for ErsatzTV settings
- `backend/tests/models/test_ersatztv.py` - Tests for ersatztv models
