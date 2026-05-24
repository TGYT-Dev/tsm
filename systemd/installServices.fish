#!/usr/bin/env fish

set SERVICE_DIR ~/.config/systemd/user

mkdir -p $SERVICE_DIR

cp tsm-mc.service $SERVICE_DIR/
cp tsm-bot.service $SERVICE_DIR/
cp tsm-playit.service $SERVICE_DIR/

systemctl --user daemon-reload
systemctl --user enable tsm-mc tsm-bot tsm-playit

echo "Services installed and enabled."
echo "They will auto-start on next boot."
echo "To start them now:"
echo "  systemctl --user start tsm-mc tsm-bot tsm-playit"
