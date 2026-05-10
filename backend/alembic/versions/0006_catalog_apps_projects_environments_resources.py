"""add apps projects environments and resources

Revision ID: 0006_catalog_apps_projects_environments_resources
Revises: 0005_catalog_teams_roles_memberships
Create Date: 2026-05-06 03:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0006_catalog_apps_projects_environments_resources"
down_revision: str | None = "0005_catalog_teams_roles_memberships"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


RESOURCE_METADATA_TYPE = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "apps",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_apps_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_apps")),
        sa.UniqueConstraint("organization_id", "name", name="uq_apps_organization_id_name"),
    )
    op.create_index(op.f("ix_apps_organization_id"), "apps", ["organization_id"], unique=False)

    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False),
        sa.Column("app_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_projects_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["app_id"],
            ["apps.id"],
            name=op.f("fk_projects_app_id_apps"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
        sa.UniqueConstraint("organization_id", "app_id", "name", name="uq_projects_organization_app_name"),
    )
    op.create_index(op.f("ix_projects_organization_id"), "projects", ["organization_id"], unique=False)
    op.create_index(op.f("ix_projects_app_id"), "projects", ["app_id"], unique=False)

    op.create_table(
        "environments",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_environments_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_environments_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_environments")),
        sa.UniqueConstraint(
            "organization_id",
            "project_id",
            "name",
            name="uq_environments_organization_project_name",
        ),
    )
    op.create_index(op.f("ix_environments_organization_id"), "environments", ["organization_id"], unique=False)
    op.create_index(op.f("ix_environments_project_id"), "environments", ["project_id"], unique=False)

    op.create_table(
        "resources",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False),
        sa.Column("app_id", sa.String(length=64), nullable=True),
        sa.Column("project_id", sa.String(length=64), nullable=True),
        sa.Column("environment_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("resource_type", sa.String(length=32), nullable=False),
        sa.Column("container_type", sa.String(length=32), nullable=False),
        sa.Column("container_id", sa.String(length=64), nullable=False),
        sa.Column("scope_type", sa.String(length=32), nullable=False),
        sa.Column("scope_id", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("metadata_json", RESOURCE_METADATA_TYPE, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_resources_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["app_id"],
            ["apps.id"],
            name=op.f("fk_resources_app_id_apps"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_resources_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["environment_id"],
            ["environments.id"],
            name=op.f("fk_resources_environment_id_environments"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_resources")),
        sa.UniqueConstraint(
            "organization_id",
            "container_type",
            "container_id",
            "scope_type",
            "scope_id",
            "name",
            name="uq_resources_catalog_container_scope_name",
        ),
    )
    op.create_index(op.f("ix_resources_organization_id"), "resources", ["organization_id"], unique=False)
    op.create_index(op.f("ix_resources_app_id"), "resources", ["app_id"], unique=False)
    op.create_index(op.f("ix_resources_project_id"), "resources", ["project_id"], unique=False)
    op.create_index(op.f("ix_resources_environment_id"), "resources", ["environment_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_resources_environment_id"), table_name="resources")
    op.drop_index(op.f("ix_resources_project_id"), table_name="resources")
    op.drop_index(op.f("ix_resources_app_id"), table_name="resources")
    op.drop_index(op.f("ix_resources_organization_id"), table_name="resources")
    op.drop_table("resources")

    op.drop_index(op.f("ix_environments_project_id"), table_name="environments")
    op.drop_index(op.f("ix_environments_organization_id"), table_name="environments")
    op.drop_table("environments")

    op.drop_index(op.f("ix_projects_app_id"), table_name="projects")
    op.drop_index(op.f("ix_projects_organization_id"), table_name="projects")
    op.drop_table("projects")

    op.drop_index(op.f("ix_apps_organization_id"), table_name="apps")
    op.drop_table("apps")
