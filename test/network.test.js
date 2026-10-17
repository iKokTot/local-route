const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nativeIpv6Available } = require('../src/core/network');

test('a Teredo default route does not enable IPv6 on an IPv4-only Wi-Fi uplink', () => {
  assert.equal(nativeIpv6Available({ ipv4InterfaceIndex: 16, ipv6DefaultInterfaces: [10], ipv6Addresses: [{ interfaceIndex: 10, address: '2001:0:1234::1' }] }), false);
});
test('native IPv6 requires both a global address and default route on the uplink', () => {
  const address = { interfaceIndex: 16, address: '2001:db8:1234::1' };
  assert.equal(nativeIpv6Available({ ipv4InterfaceIndex: 16, ipv6DefaultInterfaces: [16], ipv6Addresses: [address] }), true);
  assert.equal(nativeIpv6Available({ ipv4InterfaceIndex: 16, ipv6DefaultInterfaces: [], ipv6Addresses: [address] }), false);
  assert.equal(nativeIpv6Available({ ipv4InterfaceIndex: 16, ipv6DefaultInterfaces: [16], ipv6Addresses: [] }), false);
});
test('link-local and tunnel-only addresses do not count as native external IPv6', () => {
  for (const address of ['fe80::1234', 'fdfe:dcba:9876::1', '2001:0:1234::1', '2002:c000:0201::1']) {
    assert.equal(nativeIpv6Available({ ipv4InterfaceIndex: 16, ipv6DefaultInterfaces: [16], ipv6Addresses: [{ interfaceIndex: 16, address }] }), false, address);
  }
});
test('missing network information falls back to IPv4 safely', () => {
  assert.equal(nativeIpv6Available(null), false);
  assert.equal(nativeIpv6Available({}), false);
});
