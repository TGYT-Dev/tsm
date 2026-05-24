const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const path = require('path');
const config = require(path.resolve(process.env.HOME, 'projects/tsm/config.json'));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
    const channel = await client.channels.fetch('1501029051148796054');

    const rulesEmbed = new EmbedBuilder()
        .setTitle('Rules')
        .setColor(0xd79921)
        .setDescription(
            '### Minecraft Server\n\n' +
            '**1.** No griefing or stealing\n' +
            '**2.** No hacks or exploits, things like bedrock breaking are fine\n' +
            '**3.** No PvP without consent\n' +
            '**4.** No lag machines\n' +
            '**5.** No build pollution, make your builds look at least a little nice\n' +
            '-# ask <@&1501029453328023674> if you need help with whitelisting\n\n' +
            '### Discord\n\n' +
            '**1.** Be respectful to everyone\n' +
            '**2.** No spamming\n' +
            '**3.** No advertising other servers\n' +
            '**4.** No NSFW content\n' +
            '-# <@&1501029376106696724> have the final say in all matters\n\n' +
            '### How to get whitelist\n\n' +
            'Request access using </requestwhitelist:1503593957706305586> in <#1503584059018969160> and a moderator will approve your request.'
        );

    await channel.send({ embeds: [rulesEmbed] });

    console.log('Rules posted.');
    client.destroy();
});

client.login(config.botToken);
