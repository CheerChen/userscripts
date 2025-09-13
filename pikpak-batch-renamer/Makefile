# PikPak Batch Renamer Build Script

.PHONY: build test clean dev help

# Default target
all: build

# Build userscript
build:
	@echo "🔨 Building userscript..."
	@echo "📋 Current version: $$(cat VERSION)"
	@node build.js
	@echo "✅ Build completed! Version: $$(cat VERSION)"

# Run tests
test:
	@echo "🧪 Starting test environment..."
	@echo "Starting CORS proxy server..."
	@node proxy-server.js &
	@sleep 2
	@echo "Starting test server..."
	@echo "Please visit in browser: http://localhost:8080/test/test.html"
	@python3 -m http.server 8080

# Clean build files
clean:
	@echo "🧹 Cleaning build files..."
	@rm -rf dist/*
	@echo "✅ Cleanup completed"

# Development mode: watch files and auto-build
dev:
	@echo "👀 Development mode: watching file changes..."
	@echo "Auto-build will trigger when src/core-functions.js is modified"
	@while true; do \
		inotifywait -e modify src/core-functions.js 2>/dev/null || \
		fswatch -1 src/core-functions.js 2>/dev/null || \
		(echo "⚠️  File watching not available, please run make build manually"; break); \
		make build; \
	done

# Show help information
help:
	@echo "PikPak Batch Renamer - Build Tool"
	@echo ""
	@echo "Available commands:"
	@echo "  make build   - Build userscript"
	@echo "  make test    - Start test server"
	@echo "  make clean   - Clean build files"
	@echo "  make dev     - Development mode (auto-build)"
	@echo "  make help    - Show this help message"
	@echo ""
	@echo "Workflow:"
	@echo "  1. Edit src/core-functions.js"
	@echo "  2. Run make test for testing"
	@echo "  3. Run make build to generate userscript"
	@echo "  4. Install dist/pikpak-batch-renamer.user.js"