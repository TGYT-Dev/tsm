const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { Rcon } = require('rcon-client');
const fs = require('fs');
const path = require('path');
const http = require('http');

const config = require(path.resolve(process.env.HOME, 'projects/tsm/config.json'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
    ]
});

const configPath = path.resolve(process.env.HOME, 'projects/tsm/config.json');

const syncAllowedUsers = async () => {
    try {
        const guild   = await client.guilds.fetch(config.guildId);
        const members = await guild.members.fetch();
        const allowed = members
            .filter(m => m.roles.cache.has(config.adminRoleId))
            .map(m => m.user.id);
        config.allowedUserIds = allowed;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        console.log(`Synced ${allowed.length} allowed dashboard users`);
    } catch (err) {
        console.error('Failed to sync allowed users:', err.message);
    }
};

const queueFile = './queue.json';

const loadQueue = () => {
    if (!fs.existsSync(queueFile)) fs.writeFileSync(queueFile, '{}');
    return JSON.parse(fs.readFileSync(queueFile));
};

const saveQueue = (queue) => {
    fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2));
};

const sendRcon = async (command) => {
    const rcon = await Rcon.connect({
        host: config.rconHost,
        port: config.rconPort,
        password: config.rconPassword,
    });
    const response = await rcon.send(command);
    await rcon.end();
    return response;
};

const validateMinecraftUser = async (username) => {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (res.status === 200) return await res.json();
    return null;
};

const isAdmin = (interaction) => {
    return interaction.member?.roles.cache.has(config.adminRoleId);
};

const sendStatusEmbed = async (type) => {
    try {
        const channel = await client.channels.fetch(config.statusChannelId);
        const time = `<t:${Math.floor(Date.now() / 1000)}:t>`;
        let embed;

        switch (type) {
            case 'manualStart':
                embed = new EmbedBuilder()
                    .setTitle('Server Started')
                    .setColor(0x57F287)
                    .setDescription('The server has been manually started.')
                    .addFields({ name: 'Time', value: time });
                break;
            case 'autoStart':
                embed = new EmbedBuilder()
                    .setTitle('Server Started')
                    .setColor(0xFEE75C)
                    .setDescription('The server has automatically restarted after a crash.')
                    .addFields({ name: 'Time', value: time });
                break;
            case 'manualStop':
                embed = new EmbedBuilder()
                    .setTitle('Server Stopped')
                    .setColor(0xED4245)
                    .setDescription('The server has been manually stopped.')
                    .addFields({ name: 'Time', value: time });
                break;
            case 'crash':
                embed = new EmbedBuilder()
                    .setTitle('Server Crashed')
                    .setColor(0xED4245)
                    .setDescription('The server has crashed and will attempt to restart.')
                    .addFields({ name: 'Time', value: time });
                break;
            case 'restart':
                embed = new EmbedBuilder()
                    .setTitle('Server Restarting')
                    .setColor(0xFEE75C)
                    .setDescription('The server is restarting.')
                    .addFields({ name: 'Time', value: time });
                break;
        }

        if (embed) await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Failed to send status message:', err);
    }
};

const httpServer = http.createServer((req, res) => {
    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { type, secret } = JSON.parse(body);
            if (secret !== config.statusSecret) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            await sendStatusEmbed(type);
            res.writeHead(200);
            res.end('OK');
        } catch {
            res.writeHead(400);
            res.end('Bad Request');
        }
    });
});

const commands = [
    new SlashCommandBuilder()
        .setName('requestwhitelist')
        .setDescription('Request to be whitelisted on the server')
        .addStringOption(opt =>
            opt.setName('username')
                .setDescription('Your Minecraft username')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('approve')
        .setDescription('Approve a whitelist request')
        .addStringOption(opt =>
            opt.setName('username')
                .setDescription('Minecraft username to approve')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('deny')
        .setDescription('Deny a whitelist request')
        .addStringOption(opt =>
            opt.setName('username')
                .setDescription('Minecraft username to deny')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View pending whitelist requests'),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check the server status'),
    new SlashCommandBuilder()
        .setName('players')
        .setDescription('See who is online'),
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(config.botToken);
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, config.guildId),
            { body: commands }
        );
        console.log('Slash commands registered.');
    } catch (err) {
        console.error('Failed to register commands:', err);
    }

    httpServer.listen(config.statusPort || 4444, () => {
        console.log(`Status HTTP server listening on port ${config.statusPort || 4444}`);
    });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'requestwhitelist') {
        await interaction.deferReply({ ephemeral: true });

        const username = interaction.options.getString('username');
        const queue = loadQueue();

        if (queue[username.toLowerCase()]) {
            return interaction.editReply(`**${username}** is already in the queue waiting for approval.`);
        }

        const mojangUser = await validateMinecraftUser(username);
        if (!mojangUser) {
            return interaction.editReply(`**${username}** is not a valid Minecraft username.`);
        }

        queue[username.toLowerCase()] = {
            username: mojangUser.name,
            uuid: mojangUser.id,
            discordId: interaction.user.id,
            discordTag: interaction.user.tag,
            requestedAt: new Date().toISOString(),
        };
        saveQueue(queue);

        await interaction.editReply(`Your whitelist request for **${mojangUser.name}** has been submitted and is awaiting admin approval.`);

        const adminChannel = await client.channels.fetch(config.adminChannelId);
        const embed = new EmbedBuilder()
            .setTitle('Whitelist Request')
            .setColor(0xFF9A00)
            .addFields(
                { name: 'Minecraft Username', value: mojangUser.name, inline: true },
                { name: 'UUID', value: mojangUser.id, inline: true },
                { name: 'Discord', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
                { name: 'Requested At', value: new Date().toLocaleString(), inline: false },
            )
            .setFooter({ text: `Use /approve ${mojangUser.name} or /deny ${mojangUser.name}` });

        await adminChannel.send({ embeds: [embed] });
        return;
    }

    if (commandName === 'approve') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const username = interaction.options.getString('username');
        const queue = loadQueue();
        const entry = queue[username.toLowerCase()];

        if (!entry) {
            return interaction.editReply(`**${username}** is not in the queue.`);
        }

        try {
            await sendRcon(`whitelist add ${entry.username}`);
        } catch (err) {
            return interaction.editReply(`Failed to connect to RCON: ${err.message}`);
        }

        delete queue[username.toLowerCase()];
        saveQueue(queue);

        await interaction.editReply(`**${entry.username}** has been whitelisted.`);

        try {
            const member = await interaction.guild.members.fetch(entry.discordId);
            await member.roles.add('1501029192236797973');
            await member.roles.remove('1501029232069836830');
        } catch (err) {
            console.error('Failed to update roles:', err);
        }

        const adminChannel = await client.channels.fetch(config.adminChannelId);
        const logEmbed = new EmbedBuilder()
            .setTitle('Whitelist Approved')
            .setColor(0x57F287)
            .addFields(
                { name: 'Minecraft Username', value: entry.username, inline: true },
                { name: 'Discord', value: `<@${entry.discordId}>`, inline: true },
                { name: 'Approved By', value: `<@${interaction.user.id}>`, inline: false },
            );
        await adminChannel.send({ embeds: [logEmbed] });

        try {
            const discordUser = await client.users.fetch(entry.discordId);
            const dmEmbed = new EmbedBuilder()
                .setTitle('Whitelist Approved')
                .setColor(0x57F287)
                .setDescription(`Your whitelist request for **${entry.username}** on TSM has been approved. You can now join the server.`)
                .addFields(
                    { name: 'Minecraft Username', value: entry.username, inline: true },
                    { name: 'Status', value: 'Approved', inline: true },
                )
                .setTimestamp();
            await discordUser.send({ embeds: [dmEmbed] });
        } catch {
            await adminChannel.send(`Could not DM <@${entry.discordId}> — they may have DMs disabled.`);
        }
        return;
    }

    if (commandName === 'deny') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const username = interaction.options.getString('username');
        const queue = loadQueue();
        const entry = queue[username.toLowerCase()];

        if (!entry) {
            return interaction.editReply(`**${username}** is not in the queue.`);
        }

        delete queue[username.toLowerCase()];
        saveQueue(queue);

        await interaction.editReply(`**${entry.username}**'s whitelist request has been denied.`);

        const adminChannel = await client.channels.fetch(config.adminChannelId);
        const logEmbed = new EmbedBuilder()
            .setTitle('Whitelist Denied')
            .setColor(0xED4245)
            .addFields(
                { name: 'Minecraft Username', value: entry.username, inline: true },
                { name: 'Discord', value: `<@${entry.discordId}>`, inline: true },
                { name: 'Denied By', value: `<@${interaction.user.id}>`, inline: false },
            );
        await adminChannel.send({ embeds: [logEmbed] });

        try {
            const discordUser = await client.users.fetch(entry.discordId);
            const dmEmbed = new EmbedBuilder()
                .setTitle('Whitelist Denied')
                .setColor(0xED4245)
                .setDescription(`Your whitelist request for **${entry.username}** on TSM has been denied.`)
                .addFields(
                    { name: 'Minecraft Username', value: entry.username, inline: true },
                    { name: 'Status', value: 'Denied', inline: true },
                )
                .setTimestamp();
            await discordUser.send({ embeds: [dmEmbed] });
        } catch {
            await adminChannel.send(`Could not DM <@${entry.discordId}> — they may have DMs disabled.`);
        }
        return;
    }

    if (commandName === 'queue') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        const queue = loadQueue();
        const entries = Object.values(queue);

        if (entries.length === 0) {
            return interaction.reply({ content: 'The whitelist queue is empty.', ephemeral: true });
        }

        const list = entries.map((e, i) => `**${i + 1}.** ${e.username} — <@${e.discordId}>`).join('\n');
        const embed = new EmbedBuilder()
            .setTitle('Whitelist Queue')
            .setColor(0xFF9A00)
            .setDescription(list);

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'status') {
        await interaction.deferReply();
        try {
            const res     = await fetch(`http://localhost:3000/api/status`);
            const status  = await res.json();
            const statsRes = await fetch(`http://localhost:3000/api/stats`);
            const stats   = await statsRes.json();

            const svc = (s) => s === 'running' ? '🟢 Online' : '🔴 Offline';
            const embed = new EmbedBuilder()
                .setTitle('Server Status')
                .setColor(status.mc === 'running' ? 0x57F287 : 0xED4245)
                .addFields(
                    { name: 'MC Server', value: svc(status.mc),     inline: true },
                    { name: 'Bot',       value: svc(status.bot),     inline: true },
                    { name: 'Playit',    value: svc(status.playit),  inline: true },
                    { name: 'CPU',       value: stats.cpu    ?? '—', inline: true },
                    { name: 'RAM',       value: stats.ram    ?? '—', inline: true },
                    { name: 'Uptime',    value: stats.uptime ?? '—', inline: true },
                )
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        } catch {
            return interaction.editReply('Could not fetch server status.');
        }
    }

    if (commandName === 'players') {
        await interaction.deferReply();
        try {
            const res     = await fetch(`http://localhost:3000/api/players`);
            const players = await res.json();

            if (!players.length) {
                return interaction.editReply('No players are currently online.');
            }

            const embed = new EmbedBuilder()
                .setTitle(`Online Players (${players.length})`)
                .setColor(0xFF9A00)
                .setDescription(players.map(p => `• ${p.name}`).join('\n'))
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        } catch {
            return interaction.editReply('Could not fetch player list.');
        }
    }
});

// ── /status handler ──────────────────────────────────────────────────────────
const getServerStatus = async () => {
    try {
        const res  = await fetch(`http://localhost:${config.statusPort || 4444}/api/status-check`, {
            headers: { 'X-TSM-Secret': config.statusSecret }
        });
        return await res.json();
    } catch { return null; }
};

// ── /status handler ──────────────────────────────────────────────────────────

// Sync allowed users on ready
client.once('ready', () => syncAllowedUsers());

// Sync on role add/remove
client.on('guildMemberUpdate', (oldMember, newMember) => {
    const hadRole = oldMember.roles.cache.has(config.adminRoleId);
    const hasRole = newMember.roles.cache.has(config.adminRoleId);
    if (hadRole !== hasRole) syncAllowedUsers();
});

client.login(config.botToken);
