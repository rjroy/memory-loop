# Running as a Service (systemd)

To run Memory Loop automatically on boot (Linux with systemd):

```bash
# Copy the example service file
mkdir -p ~/.config/systemd/user
cp scripts/memory-loop.service.example ~/.config/systemd/user/memory-loop.service

# Edit the service file with your paths
# - Set WorkingDirectory to your memory-loop location
# - Set VAULTS_DIR to your vaults directory
# - Uncomment PATH line if bun isn't in /usr/bin
nano ~/.config/systemd/user/memory-loop.service

# Enable and start the service
systemctl --user daemon-reload
systemctl --user enable --now memory-loop

# Start at boot without requiring login
loginctl enable-linger $USER
```

## Useful Commands

```bash
systemctl --user status memory-loop   # Check status
systemctl --user restart memory-loop  # Restart
journalctl --user -u memory-loop -f   # View logs
```
