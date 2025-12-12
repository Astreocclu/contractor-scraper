# Systemd Installation

## Install the timer and service

```bash
# Copy unit files to systemd directory
sudo cp contractor-audit.service /etc/systemd/system/
sudo cp contractor-audit.timer /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start the timer
sudo systemctl enable contractor-audit.timer
sudo systemctl start contractor-audit.timer

# Check timer status
sudo systemctl list-timers | grep contractor
```

## Manual control

```bash
# Start immediately (for testing)
sudo systemctl start contractor-audit.service

# Stop running job
sudo systemctl stop contractor-audit.service

# View logs
journalctl -u contractor-audit.service -f

# Check next scheduled run
systemctl list-timers contractor-audit.timer
```

## Disable

```bash
sudo systemctl stop contractor-audit.timer
sudo systemctl disable contractor-audit.timer
```
