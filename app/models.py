"""Modelos ORM."""
import datetime

from sqlalchemy import JSON, Column, DateTime, String

from .db import Base


def _utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


class Document(Base):
    """Documento canónico ingerido (validado contra JSON Schema)."""

    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    entity_type = Column(String, nullable=False, index=True)
    schema_version = Column(String, nullable=False)
    body = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
