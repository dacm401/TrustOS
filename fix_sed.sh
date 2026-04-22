find /app/.next -type f -name '*.js' | xargs sed -i '' 's|http://backend:3001|http://localhost:3001|g'
