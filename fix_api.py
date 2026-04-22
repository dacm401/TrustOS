import os
import sys

def replace_in_file(filepath):
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    if 'http://backend:3001' in content:
        new_content = content.replace('http://backend:3001', 'http://localhost:3001')
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Fixed: {filepath}")

for root, dirs, files in os.walk('/app/.next'):
    for filename in files:
        if filename.endswith('.js'):
            filepath = os.path.join(root, filename)
            try:
                replace_in_file(filepath)
            except Exception as e:
                print(f"Error in {filepath}: {e}")

print("Done!")
