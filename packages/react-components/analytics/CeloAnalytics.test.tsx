import CeloAnalytics, { AnalyzedApps } from '@celo/react-components/analytics/CeloAnalytics'
import ReactNativeLogger from '@celo/react-components/services/ReactNativeLogger'

enum MockPropertyWhitelist {
  address = 'address',
  validationType = 'validationType',
  'navigation.state.routeName' = 'navigation.state.routeName',
  title = 'title',
}

const c = new CeloAnalytics(AnalyzedApps.Wallet, MockPropertyWhitelist, new ReactNativeLogger())

jest.mock('@segment/analytics-react-native', () => undefined)
jest.mock('@segment/analytics-react-native-firebase', () => undefined)

it('filters correctly', () => {
  const allProps = {
    dummyprop: 5,
    navigation: {
      state: {
        routeName: 'someroute',
      },
    },
    title: 'some title',
  }
  expect(c.applyWhitelist(allProps)).toHaveProperty(
    'navigation.state.routeName',
    allProps.navigation.state.routeName
  )
  expect(c.applyWhitelist(allProps)).toHaveProperty('title', allProps.title)
  expect(c.applyWhitelist(allProps)).not.toHaveProperty('dummyProps')
})

it('tracks events with subEvents correctly', () => {
  const defaultDateNow = Date.now
  const defaultTrackMethod = c.track
  c.track = jest.fn()

  Date.now = jest.fn(() => 1000)
  c.startTracking('mockEvent')
  Date.now = jest.fn(() => 2000)
  c.trackSubEvent('mockEvent', 'step1', { address: '0xce10ce10ce10ce10ce10ce10ce10ce10ce10ce10' })
  Date.now = jest.fn(() => 3500)
  c.trackSubEvent('mockEvent', 'step2', { validationType: 0 })
  Date.now = jest.fn(() => 4000)
  c.stopTracking('mockEvent')

  expect(c.track).toHaveBeenCalledWith(
    'mockEvent',
    {
      step1: 1000,
      step2: 1500,
      __endTracking__: 500,
      __totalTime__: 3000,
      address: '0xce10ce10ce10ce10ce10ce10ce10ce10ce10ce10',
      validationType: 0,
    },
    false
  )

  c.track = defaultTrackMethod
  Date.now = defaultDateNow
})
