"""Focused tests for typed ARM container creation requests."""

import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.config import SampleConfig
from src.control_plane import _build_container_create_parameters, create_containers


class ControlPlaneTests(unittest.TestCase):
    def test_typed_request_preserves_uri_and_body_container_name(self) -> None:
        container_name = "hotels_diskann"
        parameters = _build_container_create_parameters(
            container_name=container_name,
            partition_key_path="/Region",
            embedding_field="/embedding",
            dimensions=1536,
            index_type="diskANN",
            location="eastus2",
        )

        self.assertEqual(parameters.resource.id, container_name)
        self.assertEqual(parameters.location, "eastus2")
        self.assertEqual(
            parameters.resource.indexing_policy.vector_indexes[0].type,
            "diskANN",
        )

    @patch("src.control_plane.CosmosDBManagementClient")
    def test_create_uses_matching_uri_and_body_ids(self, client_type: MagicMock) -> None:
        sql_resources = client_type.return_value.sql_resources
        sql_resources.begin_delete_sql_container.return_value.result.return_value = None
        sql_resources.begin_create_update_sql_container.return_value.result.return_value = None
        config = SampleConfig(
            cosmos_endpoint="https://example.documents.azure.com:443/",
            database_name="HotelsCreateIndex",
            container_name=None,
            openai_embedding_endpoint="https://example.openai.azure.com/",
            openai_embedding_deployment="text-embedding-3-small",
            openai_embedding_api_version="2024-08-01-preview",
            vector_algorithm=None,
            data_file_with_vectors=Path("data.json"),
            subscription_id="subscription",
            resource_group="resource-group",
            account_name="account",
            location="eastus2",
        )

        create_containers(MagicMock(), config)

        calls = sql_resources.begin_create_update_sql_container.call_args_list
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual(
                call.kwargs["container_name"],
                call.kwargs["create_update_sql_container_parameters"].resource.id,
            )


if __name__ == "__main__":
    unittest.main()
