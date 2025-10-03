#!/bin/bash
# Load .env and run Python script
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
python "$@"