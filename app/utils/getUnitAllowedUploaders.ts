import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from './dynamodb';
import { SUNDAY_GUIDE_UNITS, getSundayGuideUnitConfig } from '../config/constants';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
const UNIT_CONFIG_KEY = '__SYSTEM_UNIT_CONFIGS__';
const UNIT_CONFIG_TYPE = 'SUNDAY_GUIDE_UNIT_CONFIGS';

export interface UnitConfigs {
  agape: string[];
  eastChristHome: string[];
  jianZhu: string[];
  cfscChurch: string[];
  chinesePastorNetwork: string[];
}

/** Read unit allowedUploaders from DynamoDB; falls back to static constants on error. */
export async function getUnitConfigsFromDB(): Promise<UnitConfigs> {
  try {
    const client = await createDynamoDBClient();
    const result = await client.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'assistantId = :key',
        ExpressionAttributeValues: { ':key': UNIT_CONFIG_KEY },
        ScanIndexForward: false,
        Limit: 20,
      })
    );
    const items = result.Items || [];
    const record = items.find((i) => i.recordType === UNIT_CONFIG_TYPE);
    if (record) {
      const staticFallback = (key: string) => [...((SUNDAY_GUIDE_UNITS as any)[key]?.allowedUploaders ?? [])];
      return {
        agape: Array.isArray(record.agapeUploaders) ? record.agapeUploaders.map(String) : staticFallback('agape'),
        eastChristHome: Array.isArray(record.eastChristHomeUploaders) ? record.eastChristHomeUploaders.map(String) : staticFallback('eastChristHome'),
        jianZhu: Array.isArray(record.jianZhuUploaders) ? record.jianZhuUploaders.map(String) : staticFallback('jianZhu'),
        cfscChurch: Array.isArray(record.cfscChurchUploaders) ? record.cfscChurchUploaders.map(String) : staticFallback('cfscChurch'),
        chinesePastorNetwork: Array.isArray(record.chinesePastorNetworkUploaders) ? record.chinesePastorNetworkUploaders.map(String) : staticFallback('chinesePastorNetwork'),
      };
    }
  } catch (e) {
    console.warn('[getUnitConfigsFromDB] DynamoDB read failed, falling back to static config:', e);
  }
  // Static fallback
  return {
    agape: [...((SUNDAY_GUIDE_UNITS as any).agape?.allowedUploaders ?? [])],
    eastChristHome: [...((SUNDAY_GUIDE_UNITS as any).eastChristHome?.allowedUploaders ?? [])],
    jianZhu: [...((SUNDAY_GUIDE_UNITS as any).jianZhu?.allowedUploaders ?? [])],
    cfscChurch: [...((SUNDAY_GUIDE_UNITS as any).cfscChurch?.allowedUploaders ?? [])],
    chinesePastorNetwork: [...((SUNDAY_GUIDE_UNITS as any).chinesePastorNetwork?.allowedUploaders ?? [])],
  };
}

/** Return allowedUploaders for a single unitId. Falls back to static constants. */
export async function getUnitAllowedUploaders(unitId: string): Promise<string[]> {
  const configs = await getUnitConfigsFromDB();
  if (unitId === 'agape') return configs.agape;
  if (unitId === 'eastChristHome') return configs.eastChristHome;
  if (unitId === 'jianZhu') return configs.jianZhu;
  if (unitId === 'cfscChurch') return configs.cfscChurch;
  if (unitId === 'chinesePastorNetwork') return configs.chinesePastorNetwork;
  // default unit uses the global upload permission list, not this function
  return [];
}
