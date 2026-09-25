#!/bin/bash

# SEP-10 Authentication Load Testing Script
# Runs comprehensive load tests on SEP-10 authentication module

set -e

echo "================================"
echo "SEP-10 Load Testing Suite"
echo "================================"

# Configuration
API_BASE_URL=${API_BASE_URL:-"http://localhost:4000"}
NUM_CONCURRENT=${NUM_CONCURRENT:-10}
NUM_ITERATIONS=${NUM_ITERATIONS:-100}
BATCH_SIZE=${BATCH_SIZE:-5}

echo "Configuration:"
echo "  API Base URL: $API_BASE_URL"
echo "  Concurrent Requests: $NUM_CONCURRENT"
echo "  Total Iterations: $NUM_ITERATIONS"
echo "  Batch Size: $BATCH_SIZE"
echo ""

# Check if API is reachable
echo "Checking API connectivity..."
if ! curl -s "$API_BASE_URL/health" > /dev/null 2>&1; then
    echo "Error: API is not reachable at $API_BASE_URL"
    exit 1
fi
echo "API is reachable ✓"
echo ""

# Run load tests
echo "Starting load tests..."
node tests/load-testing/sep10-load-test.js \
    --api-base-url "$API_BASE_URL" \
    --num-concurrent "$NUM_CONCURRENT" \
    --num-iterations "$NUM_ITERATIONS" \
    --batch-size "$BATCH_SIZE"

echo ""
echo "Load tests completed!"
