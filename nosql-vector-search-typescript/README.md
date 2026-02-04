# No-sql Vector Search Samples

https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/vector-search

https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-dotnet-vector-index-query

Example output: 

```console
Using database Hotels and container hotels-at-scale-2...
Using ID field: HotelId and partition key path: /HotelId
Ensuring database Hotels exists...
Database Hotels ensured.
Ensuring container hotels-at-scale-2 exists with partition key /HotelId...
Container hotels-at-scale-2 ensured.
Reading JSON file from ../data/HotelsData_toCosmosDB_Vector.json
Reading JSON file from ../data/HotelsData_toCosmosDB_Vector.json
{"timestamp":"2025-09-08T21:34:33.340Z","level":"INFO","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Starting resilient insert operation","data":{"documentCount":50,"batchSize":50}}
{"timestamp":"2025-09-08T21:34:33.341Z","level":"INFO","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Processing batch 1/1","data":{"batchSize":50,"totalProcessed":0}}
{"timestamp":"2025-09-08T21:34:33.740Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"1","requestCharge":308.05}}
{"timestamp":"2025-09-08T21:34:34.010Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"10","requestCharge":311.67}}
{"timestamp":"2025-09-08T21:34:34.248Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"11","requestCharge":309.57}}
{"timestamp":"2025-09-08T21:34:34.453Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"12","requestCharge":313.95}}
{"timestamp":"2025-09-08T21:34:34.662Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"13","requestCharge":312.62}}
{"timestamp":"2025-09-08T21:34:34.877Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"14","requestCharge":315.67}}
{"timestamp":"2025-09-08T21:34:35.083Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"15","requestCharge":314.71}}
{"timestamp":"2025-09-08T21:34:35.290Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"16","requestCharge":311.1}}
{"timestamp":"2025-09-08T21:34:35.541Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"17","requestCharge":313.76}}
{"timestamp":"2025-09-08T21:34:35.750Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"18","requestCharge":309.38}}
{"timestamp":"2025-09-08T21:34:35.959Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"19","requestCharge":313.57}}
{"timestamp":"2025-09-08T21:34:36.164Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"2","requestCharge":303.48}}
{"timestamp":"2025-09-08T21:34:36.390Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"20","requestCharge":311.67}}
{"timestamp":"2025-09-08T21:34:36.595Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"21","requestCharge":311.29}}
{"timestamp":"2025-09-08T21:34:36.803Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"22","requestCharge":309}}
{"timestamp":"2025-09-08T21:34:37.006Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"23","requestCharge":312.62}}
{"timestamp":"2025-09-08T21:34:37.251Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"24","requestCharge":305.38}}
{"timestamp":"2025-09-08T21:34:37.462Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"25","requestCharge":313.95}}
{"timestamp":"2025-09-08T21:34:37.669Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"26","requestCharge":305.95}}
{"timestamp":"2025-09-08T21:34:37.875Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"27","requestCharge":302.71}}
{"timestamp":"2025-09-08T21:34:38.081Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"28","requestCharge":313.95}}
{"timestamp":"2025-09-08T21:34:38.279Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"29","requestCharge":305}}
{"timestamp":"2025-09-08T21:34:38.489Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"3","requestCharge":314.71}}
{"timestamp":"2025-09-08T21:34:38.709Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"30","requestCharge":305.95}}
{"timestamp":"2025-09-08T21:34:38.919Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"31","requestCharge":315.48}}
{"timestamp":"2025-09-08T21:34:39.125Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"32","requestCharge":303.48}}
{"timestamp":"2025-09-08T21:34:39.334Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"33","requestCharge":314.71}}
{"timestamp":"2025-09-08T21:34:39.541Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"34","requestCharge":313.57}}
{"timestamp":"2025-09-08T21:34:39.747Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"35","requestCharge":310.9}}
{"timestamp":"2025-09-08T21:34:40.004Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"36","requestCharge":310.52}}
{"timestamp":"2025-09-08T21:34:40.210Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"37","requestCharge":316.62}}
{"timestamp":"2025-09-08T21:34:40.422Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"38","requestCharge":309.95}}
{"timestamp":"2025-09-08T21:34:40.639Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"39","requestCharge":315.67}}
{"timestamp":"2025-09-08T21:34:40.852Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"4","requestCharge":312.62}}
{"timestamp":"2025-09-08T21:34:41.149Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"40","requestCharge":309.19}}
{"timestamp":"2025-09-08T21:34:41.356Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"41","requestCharge":312.43}}
{"timestamp":"2025-09-08T21:34:41.560Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"42","requestCharge":310.9}}
{"timestamp":"2025-09-08T21:34:41.771Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"43","requestCharge":317.14}}
{"timestamp":"2025-09-08T21:34:41.980Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"44","requestCharge":311.1}}
{"timestamp":"2025-09-08T21:34:42.188Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"45","requestCharge":306.14}}
{"timestamp":"2025-09-08T21:34:42.394Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"46","requestCharge":315.1}}
{"timestamp":"2025-09-08T21:34:42.599Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"47","requestCharge":308.62}}
{"timestamp":"2025-09-08T21:34:42.858Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"48","requestCharge":304.24}}
{"timestamp":"2025-09-08T21:34:43.068Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"49","requestCharge":316.43}}
{"timestamp":"2025-09-08T21:34:43.274Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"5","requestCharge":308.05}}
{"timestamp":"2025-09-08T21:34:43.485Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"50","requestCharge":314.9}}
{"timestamp":"2025-09-08T21:34:43.731Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"6","requestCharge":308.43}}
{"timestamp":"2025-09-08T21:34:43.942Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"7","requestCharge":315.48}}
{"timestamp":"2025-09-08T21:34:44.149Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"8","requestCharge":310.14}}
{"timestamp":"2025-09-08T21:34:44.357Z","level":"DEBUG","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Document inserted successfully","data":{"docId":"9","requestCharge":313.57}}
{"timestamp":"2025-09-08T21:34:44.357Z","level":"INFO","correlationId":"d285ee6f-c04c-4ab7-b524-4fd4bad77a46","message":"Resilient insert operation completed","data":{"inserted":50,"failed":0,"retried":0,"totalRUs":15555.09,"durationMs":11017}}

-------- OPERATION RESULTS --------
Inserted 50 of 50 documents
Total RUs consumed: 15,555.09
Average RU per document: 311.10

-------- CURRENT OPERATION COST --------
COST OF THIS OPERATION: $0.000124
This is calculated as: 15,555.09 RUs ÷ 1,000,000 × $0.008 per million RUs

-------- PROJECTED MONTHLY COST --------
ESTIMATED MONTHLY COST: $29.21
This estimate is based on your current consumption rate of 1408.47 RU/s
which would result in approximately 3650.74 million RUs per month.
The calculation extrapolates your current usage pattern over a 30-day period.
```