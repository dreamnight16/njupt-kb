"""Registration CAPTCHA challenges.

Additive only: one new table `captcha_challenges` for the self-hosted image CAPTCHA
(0.0.3, §13). Codes are stored as SHA-256 digests only; one-time use with short TTL.
"""

from alembic import op
import sqlalchemy as sa

revision = "0019_v003_captcha"
down_revision = "0018_v003_email_change"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "captcha_challenges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("purpose", sa.String(20), nullable=False, server_default="register"),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("client_ip", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_captcha_challenges_purpose", "captcha_challenges", ["purpose"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_captcha_challenges_purpose", table_name="captcha_challenges")
    op.drop_table("captcha_challenges")
