import { NextResponse } from 'next/server';
import { getUnitAllowedUploaders } from '@/app/utils/getUnitAllowedUploaders';
import { requireMember, type Identity } from './server';

type Member = Extract<Identity, { kind: 'member' }>;

/**
 * 上傳／轉錄權限：一律需登入會員；指定單位（教會）再要求在該單位的 allowedUploaders 名單中。
 * default 單位（一般牧者助手）維持既有行為：登入會員即可上傳。
 */
export async function canUploadToUnit(identity: Member, unitId?: string | null): Promise<boolean> {
  if (!unitId || unitId === 'default') return true;
  const uploaders = await getUnitAllowedUploaders(unitId);
  return uploaders.includes(identity.userId);
}

export async function requireUploader(
  request: Request,
  unitId?: string | null
): Promise<{ identity: Member } | { response: NextResponse }> {
  const auth = requireMember(request);
  if ('response' in auth) return auth;
  if (!(await canUploadToUnit(auth.identity, unitId))) {
    return { response: NextResponse.json({ success: false, code: 'FORBIDDEN', error: '無權在此單位上傳' }, { status: 403 }) };
  }
  return auth;
}
