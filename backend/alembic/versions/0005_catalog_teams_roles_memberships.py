"""add teams scoped roles memberships and assignments

Revision ID: 0005_catalog_teams_roles_memberships
Revises: 0004_organization_catalog_users
Create Date: 2026-05-06 02:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_catalog_teams_roles_memberships"
down_revision: str | None = "0004_organization_catalog_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_teams_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_teams")),
        sa.UniqueConstraint("organization_id", "name", name="uq_teams_organization_id_name"),
    )
    op.create_index(op.f("ix_teams_organization_id"), "teams", ["organization_id"], unique=False)

    op.create_table(
        "scoped_roles",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("scope_type", sa.String(length=32), nullable=False),
        sa.Column("scope_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_scoped_roles_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scoped_roles")),
        sa.UniqueConstraint(
            "organization_id",
            "scope_type",
            "scope_id",
            "name",
            name="uq_scoped_roles_organization_scope_name",
        ),
    )
    op.create_index(op.f("ix_scoped_roles_organization_id"), "scoped_roles", ["organization_id"], unique=False)

    op.create_table(
        "team_memberships",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("team_id", sa.String(length=64), nullable=False),
        sa.Column("catalog_user_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["catalog_user_id"],
            ["catalog_users.id"],
            name=op.f("fk_team_memberships_catalog_user_id_catalog_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"],
            ["teams.id"],
            name=op.f("fk_team_memberships_team_id_teams"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_team_memberships")),
        sa.UniqueConstraint("team_id", "catalog_user_id", name="uq_team_memberships_team_id_catalog_user_id"),
    )
    op.create_index(op.f("ix_team_memberships_catalog_user_id"), "team_memberships", ["catalog_user_id"], unique=False)
    op.create_index(op.f("ix_team_memberships_team_id"), "team_memberships", ["team_id"], unique=False)

    op.create_table(
        "direct_role_assignments",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("scoped_role_id", sa.String(length=64), nullable=False),
        sa.Column("catalog_user_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["catalog_user_id"],
            ["catalog_users.id"],
            name=op.f("fk_direct_role_assignments_catalog_user_id_catalog_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["scoped_role_id"],
            ["scoped_roles.id"],
            name=op.f("fk_direct_role_assignments_scoped_role_id_scoped_roles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_direct_role_assignments")),
        sa.UniqueConstraint(
            "scoped_role_id",
            "catalog_user_id",
            name="uq_direct_role_assignments_scoped_role_id_catalog_user_id",
        ),
    )
    op.create_index(
        op.f("ix_direct_role_assignments_catalog_user_id"),
        "direct_role_assignments",
        ["catalog_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_direct_role_assignments_scoped_role_id"),
        "direct_role_assignments",
        ["scoped_role_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_direct_role_assignments_scoped_role_id"), table_name="direct_role_assignments")
    op.drop_index(op.f("ix_direct_role_assignments_catalog_user_id"), table_name="direct_role_assignments")
    op.drop_table("direct_role_assignments")

    op.drop_index(op.f("ix_team_memberships_team_id"), table_name="team_memberships")
    op.drop_index(op.f("ix_team_memberships_catalog_user_id"), table_name="team_memberships")
    op.drop_table("team_memberships")

    op.drop_index(op.f("ix_scoped_roles_organization_id"), table_name="scoped_roles")
    op.drop_table("scoped_roles")

    op.drop_index(op.f("ix_teams_organization_id"), table_name="teams")
    op.drop_table("teams")
