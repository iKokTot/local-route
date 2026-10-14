const path = require('node:path');
const { createProfile } = require('./profile');

function buildEngineArgs({ engineRoot, hostListPath, googleHostListPath = hostListPath, generalHostListPath = hostListPath, telegramIpSetPath, profile }) {
  const selected = createProfile(profile);
  const upstreamFamilies = {
    zapretAlt: 'fakeSplitTs', zapretAlt2: 'split652', zapretAlt3: 'hostFakeYa', zapretAlt4: 'badseq1000', zapretAlt5: 'simpleTs',
    zapretAlt6: 'split681', zapretAlt7: 'splitSni', zapretAlt8: 'badseqNone', zapretAlt9: 'hostFakeOzon', zapretAlt10: 'fake4pda',
    zapretAlt11: 'alt11', zapretAlt12: 'alt12', zapretAlt13: 'hostFakeMail', zapretFakeTlsAuto: 'fakeTls',
    zapretFakeTlsAutoAlt: 'fakeSplitBadseq', zapretFakeTlsAutoAlt2: 'fakeMultiBadseq', zapretFakeTlsAutoAlt3: 'fakeMultiTs',
    zapretSimpleFake: 'simpleHost', zapretSimpleFakeAlt: 'simpleBadseq', zapretSimpleFakeAlt2: 'simpleTs', zapretExp: 'exp', zapretBase: 'balanced'
  };
  const strategyKey = upstreamFamilies[selected.strategy] || selected.strategy;
  const bin = (name) => path.join(engineRoot, 'bin', name);
  const hasYouTube = selected.services.includes('youtube');
  const hasDiscord = selected.services.includes('discord');
  const hasTelegram = selected.services.includes('telegram');
  const hasGeneral = hasDiscord || selected.services.includes('telegram') || selected.customDomains.length > 0;
  const tcpPorts = [...new Set(['80', '443', ...(hasTelegram ? ['5222'] : []), ...(hasDiscord ? ['2053', '2083', '2087', '2096', '8443'] : [])])].join(',');
  const udpPorts = hasDiscord ? '443,19294-19344,50000-50100' : '443';
  const common = [`--wf-tcp=${tcpPorts}`, `--wf-udp=${udpPorts}`];
  const quicRepeats = ['fakeTls', 'alt11', 'alt12', 'hostFakeMail', 'exp', 'fakeMultiBadseq', 'fakeMultiTs'].includes(strategyKey) ? '11' : '6';
  const quic = ['--filter-udp=443', `--hostlist=${hostListPath}`, '--dpi-desync=fake', `--dpi-desync-repeats=${quicRepeats}`, `--dpi-desync-fake-quic=${bin('quic_initial_www_google_com.bin')}`];
  const multi = (seq, pos, pattern, extras = []) => ['--dpi-desync=multisplit', `--dpi-desync-split-seqovl=${seq}`, `--dpi-desync-split-pos=${pos}`, `--dpi-desync-split-seqovl-pattern=${bin(pattern)}`, ...extras];
  const fake = (fooling, repeats, tlsFiles = [], extras = []) => ['--dpi-desync=fake', `--dpi-desync-repeats=${repeats}`, ...(fooling ? [`--dpi-desync-fooling=${fooling}`] : []), ...tlsFiles.map((file) => `--dpi-desync-fake-tls=${bin(file)}`), ...extras];
  const tcpProfiles = {
    // Matches Flowseal's current general (ALT12).bat for selected services.
    // IP-set and game filters are deliberately omitted: Local Route processes
    // only the domains the user selected and must not affect unrelated traffic.
    alt12: {
      google: ['--dpi-desync=hostfakesplit', '--dpi-desync-fooling=ts', '--dpi-desync-hostfakesplit-mod=host=www.google.com'],
      general: ['--dpi-desync=fake,multisplit', '--dpi-desync-split-seqovl=664', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=ts', '--dpi-desync-repeats=8', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_max_ru.bin')}`, `--dpi-desync-fake-tls=${bin('stun.bin')}`, `--dpi-desync-fake-tls=${bin('tls_clienthello_max_ru.bin')}`, `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`]
    },
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
    },
    fakeSplitTs: { google: ['--dpi-desync=fake,fakedsplit', '--dpi-desync-repeats=6', '--dpi-desync-fooling=ts', '--dpi-desync-fakedsplit-pattern=0x00', `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`], general: ['--dpi-desync=fake,fakedsplit', '--dpi-desync-repeats=6', '--dpi-desync-fooling=ts', '--dpi-desync-fakedsplit-pattern=0x00', `--dpi-desync-fake-tls=${bin('stun.bin')}`, `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`, `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] },
    split652: { google: multi(652, 2, 'tls_clienthello_www_google_com.bin'), general: multi(652, 2, 'tls_clienthello_www_google_com.bin') },
    hostFakeYa: { google: ['--dpi-desync=fake,hostfakesplit', '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com', '--dpi-desync-hostfakesplit-mod=host=www.google.com,altorder=1', '--dpi-desync-fooling=ts'], general: ['--dpi-desync=fake,hostfakesplit', '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=ya.ru', '--dpi-desync-hostfakesplit-mod=host=ya.ru,altorder=1', '--dpi-desync-fooling=ts', `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] },
    badseq1000: { google: ['--dpi-desync=fake,multisplit', '--dpi-desync-repeats=6', '--dpi-desync-fooling=badseq', '--dpi-desync-badseq-increment=1000', `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`], general: ['--dpi-desync=fake,multisplit', '--dpi-desync-repeats=6', '--dpi-desync-fooling=badseq', '--dpi-desync-badseq-increment=1000', `--dpi-desync-fake-tls=${bin('stun.bin')}`, `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`, `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] },
    split681: { google: multi(681, 1, 'tls_clienthello_www_google_com.bin'), general: multi(681, 1, 'tls_clienthello_www_google_com.bin') },
    splitSni: { google: multi(679, '2,sniext+1', 'tls_clienthello_www_google_com.bin'), general: multi(679, '2,sniext+1', 'tls_clienthello_www_google_com.bin') },
    badseqNone: { google: ['--dpi-desync=fake', '--dpi-desync-fake-tls-mod=none', '--dpi-desync-repeats=6', '--dpi-desync-fooling=badseq', '--dpi-desync-badseq-increment=2'], general: ['--dpi-desync=fake', '--dpi-desync-fake-tls-mod=none', '--dpi-desync-repeats=6', '--dpi-desync-fooling=badseq', '--dpi-desync-badseq-increment=2', `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] },
    hostFakeOzon: { google: ['--dpi-desync=hostfakesplit', '--dpi-desync-repeats=4', '--dpi-desync-fooling=ts', '--dpi-desync-hostfakesplit-mod=host=www.google.com'], general: ['--dpi-desync=hostfakesplit', '--dpi-desync-repeats=4', '--dpi-desync-fooling=ts,md5sig', '--dpi-desync-hostfakesplit-mod=host=ozon.ru'] },
    fake4pda: { google: fake('ts', 6, ['tls_clienthello_www_google_com.bin']), general: fake('ts', 6, ['stun.bin', 'tls_clienthello_4pda_to.bin'], [`--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`]) },
    alt11: { google: ['--dpi-desync=fake,multisplit', '--dpi-desync-split-seqovl=681', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=ts', '--dpi-desync-repeats=8', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`, `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`], general: ['--dpi-desync=fake,multisplit', '--dpi-desync-split-seqovl=664', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=ts', '--dpi-desync-repeats=8', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_max_ru.bin')}`, `--dpi-desync-fake-tls=${bin('stun2.bin')}`, `--dpi-desync-fake-tls=${bin('tls_clienthello_max_ru.bin')}`, `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] },
    hostFakeMail: { google: ['--dpi-desync=hostfakesplit', '--dpi-desync-fooling=ts', '--dpi-desync-hostfakesplit-mod=host=www.google.com'], general: ['--dpi-desync=fake,hostfakesplit', '--dpi-desync-fooling=ts', '--dpi-desync-hostfakesplit-mod=host=mail.ru,altorder=1', '--dpi-desync-repeats=5', `--dpi-desync-fake-tls=${bin('tls_clienthello_sochi_park.bin')}`, `--dpi-desync-fake-tls=${bin('stun2.bin')}`, `--dpi-desync-fake-http=${bin('tls_clienthello_sochi_park.bin')}`] },
    fakeSplitBadseq: { google: ['--dpi-desync=fake,fakedsplit', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=badseq', '--dpi-desync-badseq-increment=2', '--dpi-desync-repeats=8', '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com'], general: ['--dpi-desync=fake,fakedsplit', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=badseq', '--dpi-desync-badseq-increment=2', '--dpi-desync-repeats=8', '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com', `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] },
    fakeMultiBadseq: { google: ['--dpi-desync=fake,multisplit', '--dpi-desync-split-seqovl=681', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=badseq', '--dpi-desync-badseq-increment=10000000', '--dpi-desync-repeats=8', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`, '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com'], general: ['--dpi-desync=fake,multisplit', '--dpi-desync-split-seqovl=681', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=badseq', '--dpi-desync-badseq-increment=10000000', '--dpi-desync-repeats=8', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`, '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com', `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] },
    fakeMultiTs: { google: ['--dpi-desync=fake,multisplit', '--dpi-desync-split-seqovl=681', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=ts', '--dpi-desync-repeats=8', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`, '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com'], general: ['--dpi-desync=fake,multisplit', '--dpi-desync-split-seqovl=681', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=ts', '--dpi-desync-repeats=8', `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`, '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com', `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] },
    simpleHost: { google: ['--dpi-desync=hostfakesplit', '--dpi-desync-fooling=ts', '--dpi-desync-hostfakesplit-mod=host=www.google.com'], general: fake('ts', 6, ['tls_clienthello_www_google_com.bin'], [`--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`]) },
    simpleBadseq: { google: fake('badseq', 6, ['tls_clienthello_www_google_com.bin'], ['--dpi-desync-badseq-increment=2']), general: fake('badseq', 6, ['stun2.bin', 'tls_clienthello_www_google_com.bin'], ['--dpi-desync-badseq-increment=2', `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`]) },
    simpleTs: { google: fake('ts', 6, ['tls_clienthello_www_google_com.bin']), general: fake('ts', 6, ['stun2.bin', 'tls_clienthello_max_ru.bin'], [`--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`]) },
    exp: { google: ['--dpi-desync=hostfakesplit', '--dpi-desync-fooling=ts', '--dpi-desync-hostfakesplit-mod=host=www.google.com'], general: ['--dpi-desync=fake,multisplit', '--dpi-desync-split-seqovl=480', '--dpi-desync-split-pos=1', '--dpi-desync-fooling=ts', '--dpi-desync-repeats=4', `--dpi-desync-split-seqovl-pattern=${bin('stun2.bin')}`, `--dpi-desync-fake-tls=${bin('tls_clienthello_max_ru.bin')}`, `--dpi-desync-fake-http=${bin('tls_clienthello_max_ru.bin')}`] }
  };
  const strategy = tcpProfiles[strategyKey] || tcpProfiles.balanced;
  const groups = [quic];
  if (hasDiscord) {
    const discordUdp = strategyKey === 'alt12'
      ? ['--filter-udp=19294-19344,50000-50100', '--filter-l7=discord,stun', '--dpi-desync=fake', `--dpi-desync-fake-discord=${bin('stun.bin')}`, `--dpi-desync-fake-discord=${bin('ACTIVE_DISCORD_UDP.bin')}`, `--dpi-desync-fake-stun=${bin('ACTIVE_DISCORD_UDP.bin')}`, '--dpi-desync-repeats=3']
      : ['--filter-udp=19294-19344,50000-50100', '--filter-l7=discord,stun', '--dpi-desync=fake', '--dpi-desync-repeats=6', `--dpi-desync-fake-discord=${bin('ACTIVE_DISCORD_UDP.bin')}`, `--dpi-desync-fake-stun=${bin('ACTIVE_DISCORD_UDP.bin')}`];
    groups.push(
      discordUdp,
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
