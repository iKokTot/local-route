const path = require('node:path');
const { createProfile } = require('./profile');

function buildEngineArgs({ engineRoot, hostListPath, googleHostListPath = hostListPath, generalHostListPath = hostListPath, telegramIpSetPath, profile }) {
  const selected = createProfile(profile);
  const bin = (name) => path.join(engineRoot, 'bin', name);
  const hasYouTube = selected.services.includes('youtube');
  const hasDiscord = selected.services.includes('discord');
  const hasTelegram = selected.services.includes('telegram');
  const hasGeneral = hasDiscord || selected.services.includes('telegram') || selected.customDomains.length > 0;
  const tcpPorts = [...new Set(['80', '443', ...(hasTelegram ? ['5222'] : []), ...(hasDiscord ? ['2053', '2083', '2087', '2096', '8443'] : [])])].join(',');
  const udpPorts = hasDiscord ? '443,19294-19344,50000-50100' : '443';
  const common = [`--wf-tcp=${tcpPorts}`, `--wf-udp=${udpPorts}`];
  const quicRepeats = selected.strategy === 'fakeTls' ? '11' : '6';
  const quic = ['--filter-udp=443', `--hostlist=${hostListPath}`, '--dpi-desync=fake', `--dpi-desync-repeats=${quicRepeats}`, `--dpi-desync-fake-quic=${bin('quic_initial_www_google_com.bin')}`];
  const tcpProfiles = {
    balanced: {
      google: ['--dpi-desync=multisplit', '--dpi-desync-split-seqovl=681', '--dpi-desync-split-pos=1', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`],
      general: ['--dpi-desync=multisplit', '--dpi-desync-split-seqovl=568', '--dpi-desync-split-pos=1', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_4pda_to.bin')}`]
    },
    compatibility: {
      google: ['--dpi-desync=hostfakesplit', '--dpi-desync-fooling=ts', '--dpi-desync-hostfakesplit-mod=host=www.google.com'],
      general: ['--dpi-desync=fake', '--dpi-desync-repeats=6', '--dpi-desync-fooling=ts', `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`, `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`]
    },
    split2: {
      google: ['--dpi-desync=multisplit', '--dpi-desync-split-seqovl=652', '--dpi-desync-split-pos=2', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`],
      general: ['--dpi-desync=multisplit', '--dpi-desync-split-seqovl=652', '--dpi-desync-split-pos=2', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`]
    },
    fakeSplit: {
      google: ['--dpi-desync=fake,fakedsplit', '--dpi-desync-repeats=6', '--dpi-desync-fooling=ts', '--dpi-desync-fakedsplit-pattern=0x00', `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`],
      general: ['--dpi-desync=fake,fakedsplit', '--dpi-desync-repeats=6', '--dpi-desync-fooling=ts', '--dpi-desync-fakedsplit-pattern=0x00', `--dpi-desync-fake-tls=${bin('stun.bin')}`, `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`, `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`]
    },
    fakeTls: {
      google: ['--dpi-desync=fake,multidisorder', '--dpi-desync-split-pos=1,midsld', '--dpi-desync-repeats=11', '--dpi-desync-fooling=badseq', '--dpi-desync-fake-tls=0x00000000', '--dpi-desync-fake-tls=!', '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com'],
      general: ['--dpi-desync=fake,multidisorder', '--dpi-desync-split-pos=1,midsld', '--dpi-desync-repeats=11', '--dpi-desync-fooling=badseq', '--dpi-desync-fake-tls=0x00000000', '--dpi-desync-fake-tls=!', '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com', `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`]
    }
  };
  const strategy = tcpProfiles[selected.strategy] || tcpProfiles.balanced;
  const groups = [quic];
  if (hasDiscord) {
    groups.push(
      ['--filter-udp=19294-19344,50000-50100', '--filter-l7=discord,stun', '--dpi-desync=fake', '--dpi-desync-repeats=6', `--dpi-desync-fake-discord=${bin('ACTIVE_DISCORD_UDP.bin')}`, `--dpi-desync-fake-stun=${bin('ACTIVE_DISCORD_UDP.bin')}`],
      ['--filter-tcp=2053,2083,2087,2096,8443', '--hostlist-domains=discord.media', ...strategy.general]
    );
  }
  if (hasYouTube) groups.push(['--filter-tcp=443', `--hostlist=${googleHostListPath}`, '--ip-id=zero', ...strategy.google]);
  if (hasGeneral) groups.push(['--filter-tcp=80,443', `--hostlist=${generalHostListPath}`, ...strategy.general]);
  if (hasTelegram && telegramIpSetPath) {
    groups.push([
      '--filter-tcp=80,443,5222', `--ipset=${telegramIpSetPath}`,
      '--dpi-desync-any-protocol=1', '--dpi-desync-cutoff=n4',
      ...strategy.general,
      `--dpi-desync-fake-unknown=${bin('stun2.bin')}`,
      `--dpi-desync-fake-unknown=${bin('tls_clienthello_www_google_com.bin')}`
    ]);
  }
  return [...common, ...groups.flatMap((group, index) => index === 0 ? group : ['--new', ...group])];
}

module.exports = { buildEngineArgs };
