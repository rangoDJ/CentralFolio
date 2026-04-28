#!/bin/sh

echo "=== CentralFolio Project Info ==="
echo "Node version:"
node -v 2>/dev/null || echo "Node not available"
echo "npm version:"
npm -v 2>/dev/null || echo "npm not available"
echo "Local Dev Mode Active (No Docker)"
echo "================================="
