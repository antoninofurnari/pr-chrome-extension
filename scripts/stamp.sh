#!/bin/sh
# Write a fresh timestamp to dev-stamp.txt. With dev mode on, the extension
# notices the change within ~1.5 s, reloads itself and reloads EM tabs.
cd "$(dirname "$0")/.." && date +%s%N > dev-stamp.txt
