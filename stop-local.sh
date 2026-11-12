#!/bin/bash
# Stops the local EBISU NAP Checker servers. Postgres is left running.

pkill -f "node src/server.js" 2>/dev/null && echo "stopped backend" || echo "backend was not running"
pkill -f "expo start" 2>/dev/null && echo "stopped Expo" || echo "Expo was not running"
