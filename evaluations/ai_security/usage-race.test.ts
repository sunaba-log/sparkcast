import { expect, test, vi } from 'vitest';
vi.mock('@/server/env', () => ({ getPendingChatLimit:()=>5, getPendingEpisodeUploadLimit:()=>2, getPendingRecordingSessionLimit:()=>2, getRateLimitHourly:()=>10, getRateLimitDaily:()=>100 }));
import { checkUsageAllowed, recordUsage } from '@/server/usage-limit';
test('OPS observation: two checks before recording can both consume the last slot', async () => {
 let count=9;
 const pool={query:vi.fn(async (sql:string) => {
  if(sql.includes('INSERT')) {count++;return {rows:[]};}
  return {rows:[{count}]};
 })};
 const user={uid:'synthetic-user',approvalStatus:'active'};
 const results=await Promise.all([checkUsageAllowed(pool as any,user as any,'chat'),checkUsageAllowed(pool as any,user as any,'chat')]);
 expect(results.map(x=>x.allowed)).toEqual([true,true]);
 await Promise.all([recordUsage(pool as any,user.uid,'chat'),recordUsage(pool as any,user.uid,'chat')]);
 expect(count).toBe(11);
});
