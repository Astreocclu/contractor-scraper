#!/usr/bin/env python3
import sqlite3
import sys

done_ids = [65, 186, 343, 351, 181, 489, 510, 515, 678, 813, 847, 850, 483, 1004, 1117, 1129, 1228, 1242, 1295, 1519]
done_str = ','.join(map(str, done_ids))

conn = sqlite3.connect('db.sqlite3')
cursor = conn.execute(f'SELECT id FROM contractors_contractor WHERE trust_score IS NULL AND id NOT IN ({done_str}) ORDER BY RANDOM() LIMIT 100')
ids = [str(row[0]) for row in cursor.fetchall()]
conn.close()

with open('/tmp/ids100.txt', 'w') as f:
    f.write(' '.join(ids))

print(' '.join(ids))
