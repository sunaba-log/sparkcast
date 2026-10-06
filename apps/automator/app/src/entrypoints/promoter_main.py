"""SNS auto-posting entrypoint."""

from __future__ import annotations

import logging
import os

from infrastructure.secret_manager import SecretManagerClient
from services.firestore_manager import FirestoreManager
from usecases.auto_post_sns import AutoPostSnsUsecase

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(message)s", force=True)


def _required_env(environ: dict[str, str], key: str) -> str:
    """Return required environment value or raise ValueError."""
    value = environ.get(key)
    if value is None:
        msg = f"{key} environment variable is required."
        logger.error(msg)
        raise ValueError(msg)
    return value


def auto_post_sns() -> None:
    """Fetch due SNS promotion posts and post the oldest one to X."""
    project_id = _required_env(os.environ, "PROJECT_ID")

    secret_provider = SecretManagerClient(project_id=project_id)
    firestore_manager = FirestoreManager(project_id=project_id)
    usecase = AutoPostSnsUsecase(
        firestore_manager=firestore_manager,
        secret_provider=secret_provider,
        logger=logger,
    )
    usecase.run()


def main() -> None:
    """Main entry point."""
    auto_post_sns()


if __name__ == "__main__":
    main()
