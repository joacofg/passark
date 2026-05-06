"""add audit events

Revision ID: 0003_audit_events
Revises: 0002_auth_schema
Create Date: 2026-05-06 00:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_audit_events"
down_revision: str | None = "0002_auth_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("operation", sa.String(length=128), nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("reason_code", sa.String(length=64), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_audit_events_actor_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_events")),
    )
    op.create_index(op.f("ix_audit_events_actor_user_id"), "audit_events", ["actor_user_id"], unique=False)
    op.create_index(op.f("ix_audit_events_correlation_id"), "audit_events", ["correlation_id"], unique=False)
    op.create_index(op.f("ix_audit_events_operation"), "audit_events", ["operation"], unique=False)
    op.create_index(op.f("ix_audit_events_reason_code"), "audit_events", ["reason_code"], unique=False)
    op.create_index(op.f("ix_audit_events_session_id"), "audit_events", ["session_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_audit_events_session_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_reason_code"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_operation"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_correlation_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_actor_user_id"), table_name="audit_events")
    op.drop_table("audit_events")
