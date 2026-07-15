# Sample data

For the nosql-create-index-python sample, the large vector data files are not stored in this folder to avoid duplicating them across every language sample. They live once in the repository-root [`/data`](../../data) directory.

Before running this sample, copy the required data file(s) from the repository-root `/data` directory into this `data/` folder:

- `HotelsData_toCosmosDB_byRegion.json`
- `HotelsData_toCosmosDB_Vector_byRegion.json`

For example, from this sample's folder:

```bash
cp ../../data/HotelsData_toCosmosDB_byRegion.json ./data/
cp ../../data/HotelsData_toCosmosDB_Vector_byRegion.json ./data/
```

```powershell
Copy-Item ..\..\data\HotelsData_toCosmosDB_byRegion.json .\data\
Copy-Item ..\..\data\HotelsData_toCosmosDB_Vector_byRegion.json .\data\
```