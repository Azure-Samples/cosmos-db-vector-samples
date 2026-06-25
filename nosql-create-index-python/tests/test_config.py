"""Unit tests for config loading and validation."""

import unittest

from src.config import ConfigError, load_config, sample_root, target_containers, validate_config


class ConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.valid_env = {
            "AZURE_COSMOSDB_ENDPOINT": "https://example.documents.azure.com:443/",
            "AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME": "Hotels",
            "AZURE_COSMOSDB_CONTAINER_NAME": "",
            "AZURE_OPENAI_EMBEDDING_ENDPOINT": "https://example.openai.azure.com/",
            "AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "text-embedding-3-small",
            "AZURE_OPENAI_EMBEDDING_API_VERSION": "2024-08-01-preview",
            "VECTOR_ALGORITHM": "",
            "DATA_FILE_WITH_VECTORS_AND_REGIONS": "..\\data\\HotelsData_toCosmosDB_Vector_byRegion.json",
        }

    def test_load_config_defaults_to_both_containers(self) -> None:
        config = load_config(self.valid_env)
        self.assertEqual(
            tuple(target_containers(config)),
            ("hotels_diskann", "hotels_quantizedflat"),
        )

    def test_load_config_resolves_shared_data_file(self) -> None:
        config = load_config(self.valid_env)
        expected_path = (
            sample_root() / "..\\data\\HotelsData_toCosmosDB_Vector_byRegion.json"
        ).resolve()
        self.assertEqual(config.data_file_with_vectors, expected_path)

    def test_load_config_supports_legacy_data_file_variable(self) -> None:
        env = dict(self.valid_env)
        env.pop("DATA_FILE_WITH_VECTORS_AND_REGIONS")
        env["DATA_FILE_WITH_VECTORS"] = "..\\data\\HotelsData_toCosmosDB_Vector.json"
        config = load_config(env)
        expected_path = (sample_root() / "..\\data\\HotelsData_toCosmosDB_Vector.json").resolve()
        self.assertEqual(config.data_file_with_vectors, expected_path)

    def test_validate_config_rejects_missing_required_values(self) -> None:
        invalid_env = dict(self.valid_env)
        invalid_env["AZURE_OPENAI_EMBEDDING_ENDPOINT"] = ""
        config = load_config(invalid_env)

        with self.assertRaises(ConfigError):
            validate_config(config)

    def test_validate_config_rejects_inconsistent_container_and_algorithm(self) -> None:
        invalid_env = dict(self.valid_env)
        invalid_env["AZURE_COSMOSDB_CONTAINER_NAME"] = "hotels_quantizedflat"
        invalid_env["VECTOR_ALGORITHM"] = "diskann"
        config = load_config(invalid_env)

        with self.assertRaises(ConfigError):
            validate_config(config)

    def test_validate_config_accepts_single_algorithm(self) -> None:
        env = dict(self.valid_env)
        env["VECTOR_ALGORITHM"] = "diskann"
        config = load_config(env)
        validate_config(config)
        self.assertEqual(tuple(target_containers(config)), ("hotels_diskann",))


if __name__ == "__main__":
    unittest.main()
