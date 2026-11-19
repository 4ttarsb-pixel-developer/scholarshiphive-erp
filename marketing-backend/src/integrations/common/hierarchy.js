// Canonical read-only view shared by Meta, Google Ads and TikTok adapters.
const {asNumber}=require('./request');
const safeId=value=>value===undefined||value===null?'':String(value);
const normalStatus=value=>String(value||'UNKNOWN').toUpperCase();
const metricsFrom=(m,units=1)=>m?({
  spend:Math.round(asNumber(m.spend ?? m.costMicros/units)*100)/100,
  impressions:asNumber(m.impressions), clicks:asNumber(m.clicks),
  leads:m.leads===undefined?null:m.leads,
  conversions:m.conversions===undefined?null:m.conversions
}):null;
const ad=(item)=>({
  id:safeId(item.id), name:item.name||'Unnamed ad',status:normalStatus(item.status),
  effectiveStatus:normalStatus(item.effectiveStatus||item.status),
  campaignId:safeId(item.campaignId), adGroupId:safeId(item.adGroupId),
  metrics:item.metrics||null
});
function totals(ads){
  const valid=ads.filter(a=>a.metrics!==null);
  if(!valid.length)return null;
  return {
    spend:Math.round(valid.reduce((n,a)=>n+a.metrics.spend,0)*100)/100,
    clicks:valid.reduce((n,a)=>n+a.metrics.clicks,0),
    impressions:valid.reduce((n,a)=>n+a.metrics.impressions,0),
    leads:null,conversions:null
  };
}
module.exports={safeId,normalStatus,metricsFrom,ad,totals};
