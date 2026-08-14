"""Configuration helpers for the nosql-create-index-python sample."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional, Sequence

KNOWN_CONTAINERS = {
    "diskann": os.getenv("AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME", "hotels_diskann"),
    "quantizedflat": os.getenv("AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME", "hotels_quantizedflat"),
}

REQUIRED_ENV_VARS = (
    "AZURE_COSMOSDB_ENDPOINT",
    "AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME",
    "AZURE_OPENAI_EMBEDDING_ENDPOINT",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
)

# Additional env vars needed for control plane (ARM SDK) operations
CONTROL_PLANE_ENV_VARS = (
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_RESOURCE_GROUP",
    "AZURE_COSMOSDB_ACCOUNT_NAME",
)

DEFAULT_QUERY_TEXT = "hotel near the ocean"
DEFAULT_EMBEDDING_API_VERSION = "2024-08-01-preview"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_FIELD = "embedding"  # fallback; read from AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD if available
DEFAULT_PARTITION_KEY_VALUE = "Northeast"  # Region partition key (one of: Northeast, Midwest, South, West)
DEFAULT_TOP_COUNT = 5
EXPECTED_DIMENSIONS = 1536


@dataclass(frozen=True)
class SampleConfig:
    cosmos_endpoint: str
    database_name: str
    container_name: Optional[str]
    openai_embedding_endpoint: str
    openai_embedding_deployment: str
    openai_embedding_api_version: str
    vector_algorithm: Optional[str]
    data_file_with_vectors: Path
    # Control plane (ARM SDK) fields
    subscription_id: str = ""
    resource_group: str = ""
    account_name: str = ""
    # Data plane fields
    query_text: str = DEFAULT_QUERY_TEXT
    embedding_model_name: str = DEFAULT_EMBEDDING_MODEL
    embedding_field_name: str = DEFAULT_EMBEDDING_FIELD
    partition_key_value: str = DEFAULT_PARTITION_KEY_VALUE
    top_count: int = DEFAULT_TOP_COUNT
    expected_dimensions: int = EXPECTED_DIMENSIONS


class ConfigError(ValueError):
    """Raised when the sample configuration is invalid."""


def sample_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _clean(value: Optional[str]) -> Optional[str]:
    """Clean environment variable value: strip whitespace and surrounding quotes."""
    if value is None:
        return None
    cleaned = value.strip()
    # Strip surrounding quotes (handles .env files with KEY="value" or KEY='value')
    if len(cleaned) >= 2:
        if (cleaned[0] == '"' and cleaned[-1] == '"') or (cleaned[0] == "'" and cleaned[-1] == "'"):
            cleaned = cleaned[1:-1]
    return cleaned or None


def _resolve_data_file(path_value: str) -> Path:
    candidate = Path(path_value)
    if candidate.is_absolute():
        return candidate
    return (sample_root() / candidate).resolve()


def missing_environment_variables(env: Optional[Mapping[str, str]] = None) -> Sequence[str]:
    environment = env or os.environ
    missing = []
    for name in REQUIRED_ENV_VARS:
        if not _clean(environment.get(name)):
            missing.append(name)
    return tuple(missing)


def load_config(env: Optional[Mapping[str, str]] = None) -> SampleConfig:
    environment = env or os.environ

    data_file_value = _clean(environment.get("DATA_FILE_WITH_VECTORS_AND_REGIONS"))
    if not data_file_value:
        data_file_value = _clean(environment.get("DATA_FILE_WITH_VECTORS"))
    if not data_file_value:
        data_file_value = "./data/HotelsData_toCosmosDB_Vector_byRegion.json"

    partition_key_value = _clean(environment.get("PARTITION_KEY_VALUE")) or DEFAULT_PARTITION_KEY_VALUE

    return SampleConfig(
        cosmos_endpoint=_clean(environment.get("AZURE_COSMOSDB_ENDPOINT")) or "",
        database_name=_clean(environment.get("AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME")) or "",
        container_name=_clean(environment.get("AZURE_COSMOSDB_CONTAINER_NAME")),
        openai_embedding_endpoint=_clean(environment.get("AZURE_OPENAI_EMBEDDING_ENDPOINT")) or "",
        openai_embedding_deployment=_clean(environment.get("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")) or "",
        openai_embedding_api_version=(
            _clean(environment.get("AZURE_OPENAI_EMBEDDING_API_VERSION"))
            or DEFAULT_EMBEDDING_API_VERSION
        ),
        vector_algorithm=(
            (_clean(environment.get("VECTOR_ALGORITHM")) or "").lower() or None
        ),
        data_file_with_vectors=_resolve_data_file(data_file_value),
        # Control plane (ARM SDK) fields
        subscription_id=_clean(environment.get("AZURE_SUBSCRIPTION_ID")) or "",
        resource_group=_clean(environment.get("AZURE_RESOURCE_GROUP")) or "",
        account_name=_clean(environment.get("AZURE_COSMOSDB_ACCOUNT_NAME")) or "",
        # Data plane fields
        partition_key_value=partition_key_value,
        embedding_field_name=_clean(environment.get("AZURE_COSMOSDB_CREATE_INDEX_EMBEDDED_FIELD")) or DEFAULT_EMBEDDING_FIELD,
    )


def validate_config(config: SampleConfig) -> None:
    # Validate all required variables, including ARM SDK variables needed for control plane operations
    all_required = REQUIRED_ENV_VARS + CONTROL_PLANE_ENV_VARS
    missing = [name for name in all_required if not getattr(config, _env_to_field(name))]
    if missing:
        raise ConfigError(
            "Missing required environment variables for control plane operations: {0}".format(", ".join(missing))
        )

    if config.vector_algorithm and config.vector_algorithm not in KNOWN_CONTAINERS:
        raise ConfigError(
            "VECTOR_ALGORITHM must be one of: diskann, quantizedflat."
        )

    if config.container_name and config.container_name not in KNOWN_CONTAINERS.values():
        raise ConfigError(
            "AZURE_COSMOSDB_CONTAINER_NAME must be one of: {0}".format(
                ", ".join(KNOWN_CONTAINERS.values())
            )
        )

    if config.container_name and config.vector_algorithm:
        expected_container = KNOWN_CONTAINERS[config.vector_algorithm]
        if config.container_name != expected_container:
            raise ConfigError(
                "AZURE_COSMOSDB_CONTAINER_NAME and VECTOR_ALGORITHM refer to different containers."
            )

    valid_regions = {"Northeast", "Midwest", "South", "West"}
    if config.partition_key_value not in valid_regions:
        raise ConfigError(
            "partition_key_value must be one of: {0}. Got: {1}".format(
                ", ".join(sorted(valid_regions)), config.partition_key_value
            )
        )

    if not config.data_file_with_vectors.exists():
        raise ConfigError(
            "DATA_FILE_WITH_VECTORS_AND_REGIONS (or DATA_FILE_WITH_VECTORS) does not exist: {0}".format(
                config.data_file_with_vectors
            )
        )


def target_containers(config: SampleConfig) -> Sequence[str]:
    if config.container_name:
        return (config.container_name,)
    if config.vector_algorithm:
        return (KNOWN_CONTAINERS[config.vector_algorithm],)
    return tuple(KNOWN_CONTAINERS.values())


def algorithm_label(container_name: str) -> str:
    for algorithm, known_container in KNOWN_CONTAINERS.items():
        if known_container == container_name:
            return "DiskANN" if algorithm == "diskann" else "QuantizedFlat"
    return container_name


def _env_to_field(env_name: str) -> str:
    mapping = {
        "AZURE_COSMOSDB_ENDPOINT": "cosmos_endpoint",
        "AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME": "database_name",
        "AZURE_OPENAI_EMBEDDING_ENDPOINT": "openai_embedding_endpoint",
        "AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "openai_embedding_deployment",
    }
    return mapping[env_name]
