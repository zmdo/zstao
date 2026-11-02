# 鍙充晶杈规爮銆岀綉缁滄枃浠剁鐞嗐€嶈璁℃柟妗堬紙COS锛岀 3 鐗堬級

- 鐘舵€侊細鑽夋锛屽緟纭
- 鏃ユ湡锛?026-11-03锛堢 3 鐗堬細鍏ㄥ眬棰勮缂撳瓨 + 宸ヤ綔鍖虹‖閾炬帴锛屽畾鏃舵竻鐞嗭級
- 渚濊禆锛歚@smp/console-cos`锛堝凡鏈夊弻妗?COS 鎺ュ叆锛夈€乣dsh-client-ui-sidebar-right`銆乣dsh-client-ui-sidebar-documentpreview`銆乣dsh-session`銆乣dsh-working-directory`
- 鐩爣璇昏€咃細瀹炵幇鑰呬笌璇勫鑰?
## 1. 鑳屾櫙涓庣洰鏍?
鎺у埗鍙板凡鏈夈€屾枃浠剁鐞嗐€嶉〉闈紝浣嗘搷浣滄椂瑕佸湪椤甸潰涓庝細璇濅箣闂村垏鎹€備細璇濆彸渚ц竟鏍忥紙`宸ヤ綔鍖篳 鎵€鍦ㄥ垪锛夋敮鎸佹彃浠舵敞鍐?tab锛屽洜姝ゆ柊澧炪€岀綉缁滄枃浠剁鐞嗐€嶏細

1. 鍦ㄥ彸渚ц竟鏍忔祻瑙?COS **榛樿妗?*锛坄role='default'`锛夛紱
2. 鐐瑰嚮鏂囦欢鏃?*澶嶇敤 DSH 鑷甫鐨勬枃妗ｉ瑙?*锛堜唬鐮侀珮浜€丮arkdown銆丳DF銆佸浘鐗囥€丠TML锛夛紱
3. 璁╀細璇濓紙妯″瀷/宸ュ叿锛夎兘璇诲埌杩欎簺鏂囦欢锛氱墿鍖栧埌宸ヤ綔鍖哄悗鐢?`read`/`grep` 璁块棶銆?
闈炵洰鏍囷細

- 涓嶅湪渚ц竟鏍忕紪杈戝苟鍥炲啓 COS锛堝彧璇婚瑙堬紱鍥炲啓璧版枃浠剁鐞嗛〉涓婁紶锛夛紱
- 涓嶆妸 COS 鎸傛垚铏氭嫙鏂囦欢绯荤粺锛屼笉鏀瑰彉鐜版湁 `fs` 宸ュ叿鐨勫伐浣滃尯杈圭晫锛?- 涓嶆帴鍏ラ檮浠舵《锛?- 涓嶅仛澶氫汉鍏变韩涓庡湪绾垮崗浣溿€?
## 2. 鍏ュ彛涓庝氦浜?
- 鍏ュ彛锛?  - 鍙充晶杈规爮銆孧ore tools銆嶅崱鐗囦腑鐨勩€岀綉缁滄枃浠剁鐞嗐€嶏紱
  - 鏂囦欢绠＄悊椤甸潰鏂板銆屽湪渚ц竟鏍忔墦寮€銆嶆寜閽€?- tab 绫诲瀷锛歚kind: 'cos-files'`锛屽湴鍧€ `sidebar://cos-files`銆?- 甯冨眬锛?  - 椤堕儴锛氬綋鍓嶅墠缂€闈㈠寘灞戙€佸埛鏂帮紱
  - 鍒楄〃锛氫笌鏂囦欢绠＄悊椤靛悓涓€濂?`smp-plugins` 琛ㄦ牸锛堢洰褰?鏂囦欢銆佸ぇ灏忋€佹椂闂达級锛?  - 鎿嶄綔锛氬崟鍑荤洰褰曡繘鍏ワ紱鍗曞嚮鏂囦欢鍦ㄤ晶杈规爮**鏂板紑涓€涓枃妗ｉ瑙?tab**锛孋OS 鍒楄〃 tab 淇濈暀锛?  - 姣忎釜鏂囦欢琛屾彁渚涖€屼笅杞姐€嶃€屽湪浼氳瘽涓紩鐢ㄣ€嶃€?- 鏈厤缃粯璁ゆ《鏃讹紝tab 鍐呭睍绀恒€屽幓骞冲彴璁剧疆 鈫?瀵硅薄瀛樺偍閰嶇疆銆嶇殑鎻愮ず锛屼笉鎶ラ敊銆?
## 3. 鎬讳綋鏋舵瀯

```
plugins/cos/src/client/
  sidebar/
    definition.ts      tab 绫诲瀷瀹氫箟 + guide 鍏ュ彛
    CosFilesBody.tsx   鍒楄〃 / 闈㈠寘灞?/ 鍔ㄤ綔
    CosFilesTitle.tsx  鏍囬銆岀綉缁滄枃浠剁鐞嗐€?    materialize.ts     璋冪墿鍖栨帴鍙ｃ€佹嫾 dsh-resource 鍦板潃銆佹墦寮€棰勮
  client.tsx           娉ㄥ唽 tab 绫诲瀷銆佷袱涓Ы浣嶃€佸懡浠?```

- 浠嶆槸 `@smp/console-cos` 涓€涓寘锛涘涓诲鐢?`/console-api/cos/*`锛屾柊澧炵墿鍖栨帴鍙ｃ€?- 鏂板杩佺Щ `0042_cos_preview_limit.sql`锛堥瑙堜笂闄愬垪锛夛紝瑙佺 7 鑺傘€?
## 4. 渚ц竟鏍?tab 鐨勬敞鍐?
鎸?`dsh-client-ui-sidebar-files` 鐨勭幇鏈夋ā寮忥細

```ts
ctx.sidebarRightTabs.register({
  id: 'smp-cos-sidebar',
  kind: 'cos-files',
  priority: 'extension',          // 闈?builtin band锛屽唴缃?tab 涓嶅彈褰卞搷
  title: () => '缃戠粶鏂囦欢绠＄悊',
  guide: [{ id: 'cos-files', commandId: 'cos.files', order: 20, title, description }],
  keepMounted: true,
})
```

鍐呭涓庢爣棰樻Ы浣嶏紙`sessionId` 鐢辨Ы浣嶆敞鍏ワ紝宸茬‘璁?`FilesBody` 鍚屾牱鎺ユ敹璇?prop锛夛細

```ts
ctx.slots.inject('sidebar.right.pane.tab', () =>
  ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: 'smp-cos-sidebar', inject: () => ({ locale, sessionId }) },
    CosFilesBody,
  ),
)
ctx.slots.inject('sidebar.right.pane.tab.title', () =>
  ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'smp-cos-sidebar' }, CosFilesTitle),
)
```

guide 鏉＄洰鐨?`commandId` 蹇呴』鎸囧悜宸叉敞鍐屽懡浠わ紝鍥犳鍚屾椂娉ㄥ唽锛?
```ts
ctx.commands.register({
  id: 'cos.files',
  title: '鎵撳紑缃戠粶鏂囦欢绠＄悊',
  run: () => ctx.sidebarRight.open('sidebar://cos-files'),
})
```

P1 鍙厛涓嶅姞 guide锛堝彧浠庢枃浠剁鐞嗛〉鎸夐挳鎵撳紑锛夛紝鍛戒护娉ㄥ唽瀹屾垚鍚庡啀琛ュ叆鍙ｃ€?
鎵撳紑鏂瑰紡锛歚ctx.sidebarRight.open('sidebar://cos-files')`锛涙枃浠堕瑙堢敤 `ctx.sidebarRight.open(fileAddress)` 鏂板紑棰勮 tab銆?
## 5. 娴忚涓庡垎椤?
- 澶嶇敤 `GET /console-api/cos/objects?prefix=&marker=&limit=&search=`锛?- 涓庢枃浠剁鐞嗛〉鍏辩敤 `listObjects` 涓?key 杈圭晫鏍￠獙锛?- 鍒嗛〉娌跨敤 marker 鏍堬紙COS 鏃犳€绘暟锛夛紝姣忛〉 20/50/100銆?
## 6. 鎵撳紑鏂囦欢锛氬叏灞€缂撳瓨 + 宸ヤ綔鍖虹‖閾炬帴

鍐呯疆棰勮鍙帴鍙?`dsh-resource://file/session/<sessionId>/<path>`锛岃鍙栬蛋浼氳瘽宸ヤ綔鍖虹殑鏂囦欢 API銆侰OS 瀵硅薄蹇呴』鍏堢墿鍖栧埌宸ヤ綔鍖恒€?
鍥犱负妗舵槸鍏ㄥ眬鐨勶紝**涓嬭浇鍙仛涓€娆?*锛氬璞¤惤鍒板叏灞€棰勮缂撳瓨锛屽啀鍦ㄤ細璇濆伐浣滃尯鏀句竴涓‖閾炬帴浣滀负棰勮鍏ュ彛銆?
### 6.1 宸ヤ綔鍖鸿В鏋愶紙瀹夸富锛?
```ts
const session = ctx.sessions.get(sessionId)          // 浠呭瓨娲讳細璇?const workspace = ctx.workingDirectory.get(session)  // 缁濆璺緞
```

涓よ€呬换涓€澶辫触杩斿洖 `session_not_found` / `workspace_unavailable`锛屼笉渚濊禆 `workingDirectory.ensure(agent)`銆?
### 6.2 鍏ㄥ眬缂撳瓨甯冨眬

缂撳瓨鏍归粯璁?`$DSH_HOME/cache/cos-preview`锛屽彲鐢ㄦ彃浠堕厤缃?`previewCacheDir` 瑕嗙洊锛堜笉鏀捐繘璁剧疆椤碉紝閬垮厤姣忎釜閮ㄧ讲閮芥敼 UI锛夈€?
```
<cacheRoot>/<etag 鍓?12 浣?/<sha1(key) 鍓?12 浣?-<basename>
<cacheRoot>/<etag 鍓?12 浣?/<sha1(key) 鍓?12 浣?-<basename>.meta.json
```

- `sha1(key)` 閬垮厤闀?key 閫犳垚 Windows 璺緞瓒呴暱銆佷互鍙婁笉鍚?key 鍚屽悕 basename 鍐茬獊锛?- `basename` 淇濈暀鎵╁睍鍚嶏紝渚涘唴缃瑙堥€夋嫨楂樹寒/娓叉煋鍣紱
- 鑻ユ棤鎵╁睍鍚嶏紝鐢?`headObject` 鐨?`content-type` 鏄犲皠鎵╁睍鍚嶏紙`.txt`/`.md`/`.json`/`.png`/`.pdf` 绛夛級锛?- `.meta.json` 璁板綍 `{ key, etag, size, contentType, createdAt, lastAccessAt }`锛?- 鍐欏叆绛栫暐锛氬厛鍐?`<file>.tmp`锛宖sync 鍚?`rename` 鍒颁綅锛屽啀鍐?meta锛岄伩鍏嶈鍒板崐鏂囦欢銆?
### 6.3 宸ヤ綔鍖洪摼鎺ュ竷灞€

```
<workspace>/.cos-cache/<sha1(key) 鍓?12 浣?-<basename>
<workspace>/.cos-cache/.index.json          # 鍙€夛細璁板綍鏈細璇濆垱寤鸿繃鐨勯摼鎺?```

- 浼樺厛 `fs.link(globalPath, workspacePath)`锛圢TFS 鍚屽嵎闆舵嫹璐濓級锛?- 纭摼鎺ュけ璐ワ紙`EXDEV` 璺ㄥ嵎銆乣EPERM` 鏉冮檺銆佹枃浠剁郴缁熶笉鏀寔锛夆啋 鍥為€€涓哄鍒讹紱
- 宸插瓨鍦ㄥ悓鍚嶅叆鍙ｆ椂锛氭牎楠?etag 涓€鑷村垯澶嶇敤锛屼笉涓€鑷村垯鏇挎崲锛?- 宸ヤ綔鍖哄叆鍙ｅ彧鏄瑙?璇诲彇鐢ㄧ殑鍚嶅瓧锛屾暟鎹粛鍦ㄥ叏灞€缂撳瓨锛堝鍒跺洖閫€鏃堕櫎澶栵級銆?
### 6.4 鐗╁寲娴佺▼

1. 渚ц竟鏍忕偣鍑绘枃浠讹紱
2. `POST /console-api/cos/materialize`锛宐ody `{ sessionId, key }`锛?3. 瀹夸富鏍￠獙锛歬ey 鍦?`basePrefix` 鍐呫€乣headObject` 鍙?etag/size銆乣size <= maxPreviewBytes`锛?4. 鍏ㄥ眬缂撳瓨鍛戒腑锛堝悓 etag + 鍚?sha1 + meta 涓€鑷达級鈫?璺宠繃涓嬭浇锛涘惁鍒欎笅杞藉苟鍘熷瓙钀界洏锛?5. 纭繚宸ヤ綔鍖哄叆鍙ｏ細纭摼鎺ヤ紭鍏堬紝澶辫触澶嶅埗锛?6. 杩斿洖锛?   ```json
   { "path": ".cos-cache/<sha>-<name>", "absolute": "鈥?, "size": 1234, "etag": "鈥?, "contentType": "text/markdown", "linked": true }
   ```
7. 瀹㈡埛绔寜娈?percent-encode 鎷煎湴鍧€骞舵墦寮€锛?   ```
   dsh-resource://file/session/<sessionId>/<encoded relative path>
   ```
8. 鍐呯疆鏂囨。棰勮鎺ョ娓叉煋锛孋OS 鍒楄〃 tab 淇濈暀銆?
### 6.5 涓嶆敮鎸佺殑绫诲瀷

- 瓒呰繃 `maxPreviewBytes`锛歚preview_too_large`锛屽彧缁欎笅杞斤紱
- 鎵╁睍鍚?content-type 涓嶅湪鍐呯疆棰勮鏀寔鑼冨洿锛歚unsupported_preview`锛屽脊缁熶竴 Dialog锛?- 浜岃繘鍒舵娴嬶細content-type 涓嶆槸 `text/*`銆乣application/json`銆乣application/pdf`銆乣image/*` 鏃剁洿鎺ヨ蛋涓嶆敮鎸佸垎鏀紝涓嶄笅杞姐€?
## 7. 閰嶇疆锛氶瑙堜笂闄愪笌缂撳瓨

### 7.1 棰勮涓婇檺锛堝彲閰嶇疆锛?
- 杩佺Щ `plugins/database/migrations/0042_cos_preview_limit.sql`锛?  ```sql
  alter table cos_buckets
    add column if not exists max_preview_bytes bigint not null default 20971520;
  ```
- 鍙 `role='default'` 鐢熸晥銆?- 骞冲彴璁剧疆 鈫?瀵硅薄瀛樺偍 鈫?榛樿妗舵柊澧炪€岄瑙堜笂闄愶紙MB锛夈€嶏細榛樿 20锛岃寖鍥?1鈥?00锛岄殢鐜版湁瀛楁鑷姩淇濆瓨銆?- `/console-api/cos/config` 杩斿洖 `maxPreviewBytes`锛汸UT 鏃舵牎楠屻€?
### 7.2 缂撳瓨閰嶇疆锛堟彃浠堕厤缃級

| 閰嶇疆 | 榛樿 | 璇存槑 |
| --- | --- | --- |
| `previewCacheDir` | `$DSH_HOME/cache/cos-preview` | 鍏ㄥ眬缂撳瓨鏍癸紝蹇呴』鍙啓 |
| `previewCacheTtlMs` | 7 澶?| 鍏ㄥ眬/宸ヤ綔鍖虹紦瀛?TTL |
| `previewCacheMaxBytes` | 2 GB | 鍏ㄥ眬缂撳瓨鎬诲ぇ灏忎笂闄?|
| `previewCleanupIntervalMs` | 6 灏忔椂 | 瀹氭椂娓呯悊闂撮殧 |

### 7.3 涓婇檺鐢熸晥鐐?
| 浣嶇疆 | 琛屼负 |
| --- | --- |
| `POST /materialize` | `size > maxPreviewBytes` 鈫?413 `preview_too_large` |
| `GET /objects/text` | 涓婇檺鏀逛负 `min(512KB, maxPreviewBytes)` |
| `platform_cos_read` | 涓婇檺 `min(64KB, maxPreviewBytes)` |
| 渚ц竟鏍忛瑙?| 瓒呴檺鍙樉绀轰笅杞芥寜閽?|

## 8. 浼氳瘽璇诲彇

### 8.1 璺緞寮曠敤锛堟帹鑽愶級

鐗╁寲鍚庤繑鍥炲伐浣滃尯鐩稿璺緞锛涗晶杈规爮鎻愪緵銆屽湪浼氳瘽涓紩鐢ㄣ€嶅鍒惰璺緞锛岀敤鎴风矘璐村埌瀵硅瘽锛孉gent 鐢?`read`/`grep` 鐩存帴璁块棶銆?
纭摼鎺ヤ笌鏅€氭枃浠跺湪璇诲彇渚ф棤宸埆锛涘鍒跺洖閫€鏃朵篃涓€鏍枫€?
### 8.2 宸ュ叿

| 宸ュ叿 | 鍙傛暟 | 瀹℃壒 | 璇存槑 |
| --- | --- | --- | --- |
| `platform_cos_materialize` | `key` | 鍚?| 鐗╁寲鍒板綋鍓嶄細璇濆伐浣滃尯锛岃繑鍥炵浉瀵硅矾寰勩€佸ぇ灏忋€乪tag銆佹槸鍚︾‖閾炬帴 |
| `platform_cos_read` | `key`銆乣max_bytes?` | 鍚?| 灏忔枃鏈洿鎺ヨ繑鍥炲唴瀹癸紝榛樿 64 KB锛屼笉瓒呰繃棰勮涓婇檺 |

- 鍙厑璁搁粯璁ゆ《锛宬ey 蹇呴』鍦?`basePrefix` 鍐咃紱
- 宸ュ叿鍦?agent 涓婁笅鏂囦腑鎵ц锛屽彲鐢?`workingDirectory.ensure(agent)` 鑾峰彇宸ヤ綔鍖猴紙涓?HTTP 璺緞鐨?`sessions.get` 浜掍负琛ュ厖锛夛紱
- 杩斿洖鍐呭涓槑纭€岃繖鏄彧璇诲壇鏈紝淇敼涓嶄細鍥炲啓 COS銆嶃€?
### 8.3 涓€鑷存€?
- 鍏ㄥ眬缂撳瓨鎸?etag 鍒嗙洰褰曪紱瀵硅薄鏇存柊 鈫?鏂?etag 鈫?鏂扮洰褰曪紱
- 鐗╁寲鍓嶅厛 `headObject`锛宔tag 鏈彉鐩存帴澶嶇敤锛屼笉閲嶅涓嬭浇锛?- 鍚屼竴 key 骞跺彂鐗╁寲鍔犺繘绋嬪唴鍗曢锛坕n-flight map锛夈€?
## 9. 瀹夸富鎺ュ彛

| 鏂规硶 | 璺緞 | 璇存槑 |
| --- | --- | --- |
| GET | `/console-api/cos/objects` | 宸叉湁锛屽垪琛?|
| GET | `/console-api/cos/objects/download` | 宸叉湁锛?02 涓嬭浇 |
| GET | `/console-api/cos/objects/raw` | 宸叉湁锛屽唴宓岄瑙堬紙鍥剧墖/PDF锛?|
| GET | `/console-api/cos/objects/text` | 宸叉湁锛屾枃鏈瑙堬紙涓婇檺鏀逛负閰嶇疆锛?|
| POST | `/console-api/cos/materialize` | 鏂板锛岀墿鍖栧苟杩斿洖宸ヤ綔鍖鸿矾寰?|

鏂板閿欒鐮侊細`session_not_found`銆乣workspace_unavailable`銆乣preview_too_large`銆乣unsupported_preview`銆乣cache_full`銆乣cache_write_failed`銆?
## 10. 缂撳瓨娓呯悊

瀹夸富鍦?`apply` 閲岀敤 `ctx.setInterval` 娉ㄥ唽瀹氭椂浠诲姟锛堥粯璁?6 灏忔椂锛夛紝鍚姩鏃朵篃璺戜竴娆★細

1. **鍏ㄥ眬缂撳瓨**锛氭壂鎻?`<cacheRoot>/<etag>/` 涓嬪甫 `.meta.json` 鐨勬潯鐩紱
   - 瓒呰繃 TTL锛? 澶╋級鈫?鍒犻櫎鏂囦欢涓?meta锛?   - 鎬婚噺瓒呰繃 `previewCacheMaxBytes` 鈫?鎸?`lastAccessAt` 浠庢棫鍒版柊鍒犲埌 80%锛?   - 鍒犻櫎涓嶅瓨鍦ㄧ殑纭摼鎺ョ洰鏍囦笉褰卞搷浼氳瘽锛圢TFS 寮曠敤璁℃暟淇濈暀鏁版嵁锛夈€?2. **宸ヤ綔鍖虹紦瀛?*锛氭壂鎻忓悇浼氳瘽宸ヤ綔鍖?`.cos-cache/`锛?   - 鍙鐞嗗甫 `.index.json` 璁板綍銆佹垨鏂囦欢鍚嶅尮閰?`<12 浣?hex>-*` 鐨勬潯鐩紱
   - 瓒呰繃 TTL 鎴栦細璇濆凡涓嶅瓨鍦?鈫?鍒犻櫎閾炬帴/鍓湰锛?   - 涓嶈Е纰?`.cos-cache` 涔嬪鐨勬枃浠躲€?3. **骞跺彂瀹夊叏**锛氭竻鐞嗕笌鐗╁寲鐢ㄥ悓涓€鎶婅繘绋嬪唴閿侊紱鍒犻櫎鍓嶆鏌?`lastAccessAt` 涓?mtime锛?4 灏忔椂鍐呰闂繃鐨勮烦杩囥€?
## 11. 瀹夊叏涓庨檺鍒?
- 鍙鍓湰锛屼笉鎻愪緵鍐欏洖锛?- key 杈圭晫锛歚basePrefix` 鏍￠獙锛屾嫆缁?`..`銆佺粷瀵硅矾寰勩€佹帶鍒跺瓧绗︼紱
- 宸ヤ綔鍖鸿竟鐣岋細宸ヤ綔鍖哄叆鍙ｅ繀椤诲湪 `workspace` 涓嬶紝绂佹閫氳繃 key 绌胯秺锛?- 鍏ㄥ眬缂撳瓨鐩綍蹇呴』鍙啓銆佷笖涓嶄綅浜庣敤鎴峰伐浣滃尯鍐呴儴锛?- 鍑嵁鍙湪瀹夸富锛孉gent 涓庢祻瑙堝櫒閮芥嬁涓嶅埌 SecretKey锛?- 瀹¤锛氱墿鍖栦笌瀹為檯涓嬭浇閮藉啓 `cos_audit`锛坄action='download'`锛宒etail 鏍囨敞 `mode: 'materialize'`銆乣etag`锛夛紱
- HTML 棰勮娌跨敤 DSH 鏃㈡湁瀹夊叏绛栫暐锛屼笉鏀惧銆?
## 12. 鍒嗛樁娈靛疄鏂?
| 闃舵 | 鍐呭 | 楠屾敹 |
| --- | --- | --- |
| P1 | `cos-files` tab銆佸垪琛?闈㈠寘灞?鍒锋柊銆佷笅杞姐€佸懡浠ゆ敞鍐?| 渚ц竟鏍忚兘娴忚榛樿妗?|
| P2 | 杩佺Щ 0042銆佽缃〉棰勮涓婇檺銆佸叏灞€缂撳瓨 + `/materialize`銆佺‖閾炬帴/澶嶅埗銆佸唴缃瑙?| 鏂囨湰楂樹寒/鍥剧墖/PDF 姝ｅ父鎵撳紑锛岃秴闄愭彁绀?|
| P3 | 浼氳瘽寮曠敤璺緞銆乣platform_cos_materialize` / `platform_cos_read` | Agent 鑳?`read` 鐗╁寲鏂囦欢锛岃法浼氳瘽澶嶇敤鍚屼竴缂撳瓨 |
| P4 | 瀹氭椂娓呯悊銆侀厤棰濄€侀敊璇脊妗嗐€佸璁″瓧娈?| 缂撳瓨涓嶅け鎺э紝璺ㄥ嵎鍥為€€鍙敤 |

## 13. 娴嬭瘯

- 鍗曞厓锛歬ey 杈圭晫銆佺紦瀛樿矾寰勭敓鎴愩€乪tag 澶嶇敤銆乧ontent-type 鍒版墿灞曞悕鏄犲皠銆佺‖閾炬帴澶辫触鍥為€€锛?- 鎺ュ彛锛氭湭鐧诲綍 401锛涙湭閰嶇疆 `cos_role_not_configured`锛沗/materialize` 瓒呴檺 413锛涜秺鐣?`key_invalid`锛涢潪瀛樻椿浼氳瘽 `session_not_found`锛?- 闆嗘垚锛?  - 渚ц竟鏍忔墦寮€ `docs/readme.md` 鍑虹幇楂樹寒锛沗pic.png` 鏄剧ず鍥剧墖锛沗blob.bin` 寮广€屾棤娉曟墦寮€銆嶏紱
  - 涓や釜浼氳瘽鎵撳紑鍚屼竴涓?key锛氬叏灞€缂撳瓨鍙笅杞戒竴娆★紙绗簩涓細璇?`linked: true` 涓旀棤鏂颁笅杞斤級锛?  - 璺ㄥ嵎鍦烘櫙锛堢紦瀛樹笌宸ヤ綔鍖轰笉鍚岀洏锛夛細鍥為€€澶嶅埗鎴愬姛锛宍linked: false`锛?  - 璁剧疆椤垫妸棰勮涓婇檺鏀规垚 1MB 鍚庯紝2MB 鏂囦欢琚嫆锛?- 浼氳瘽锛歚platform_cos_materialize` 鍚?`read` 鑳借鍒帮紱鏀规湰鍦板壇鏈笉褰卞搷 COS锛?- 娓呯悊锛歍TL 杩囨湡鏉＄洰琚垹锛岀‖閾炬帴浼氳瘽浠嶅彲鎵撳紑锛涘伐浣滃尯鍏朵粬鏂囦欢涓嶅彈褰卞搷銆?
## 14. 椋庨櫓涓庡紑鏀鹃棶棰?
1. **纭摼鎺ョ殑鍗烽檺鍒?*锛氱紦瀛樹笌宸ヤ綔鍖轰笉鍚屽嵎鏃跺洖閫€澶嶅埗锛岃法浼氳瘽鍘婚噸澶辨晥锛堜粛鍏变韩鍏ㄥ眬缂撳瓨鏂囦欢锛屽彧鏄細璇濅晶澶氫竴浠藉壇鏈級锛涢儴缃叉椂灏介噺璁?`previewCacheDir` 涓庡伐浣滃尯鍚屽嵎銆?2. **NTFS 纭摼鎺ユ潈闄?鏂囦欢绯荤粺**锛氶潪 NTFS銆佺綉缁滅洏鍙兘涓嶆敮鎸侊紝缁熶竴璧板鍒跺洖閫€銆?3. **鐐圭洰褰曞彲瑙佹€?*锛歚.cos-cache` 鑻ヨ鍐呯疆棰勮鎴栧伐浣滃尯 API 杩囨护锛屾敼鐢?`cos-cache/` 骞舵帴鍙楀畠鍑虹幇鍦ㄥ伐浣滃尯鍒楄〃銆?4. **棰勮 tab 琛屼负**锛歚open(address)` 鏂板缓/澶嶇敤涓庡垎灞忕敱 dockkit 鍐冲畾锛屼笉鍋氬畾鍒躲€?5. **娓呯悊绔炴€?*锛氬垹闄ゅ叏灞€鍚嶅瓧涓嶅奖鍝嶅凡閾炬帴鏂囦欢锛涘鍒跺洖閫€鐨勬枃浠惰嫢姝ｅ湪琚瑙堬紝鍒犻櫎鍓嶆鏌?24 灏忔椂鍐呰闂椂闂淬€?6. **鍙璇箟**锛欰gent 淇敼鍓湰涓嶅洖鍐?COS锛孶I 涓庡伐鍏烽兘闇€璇存槑銆?7. **`/tmp` 涓嶈法骞冲彴**锛氱紦瀛樻牴鐢?DSH_HOME 涓嬬殑璺緞锛屼笉鍐欐 `/tmp`锛涘闇€涓存椂鐩綍锛岀敤 `os.tmpdir()`銆?
## 15. 澶嶆牳璁板綍

### 绗?2 鐗堜慨姝?
| # | 鍘熸柟妗?| 闂 | 淇 |
| --- | --- | --- | --- |
| 1 | 鐗╁寲涓婇檺鍥哄畾 20 MB | 涓嶅彲閰嶇疆 | 鏂板 `max_preview_bytes`銆佽缃」銆佽縼绉?0042 |
| 2 | 瀹夸富闈?`workingDirectory.ensure(agent)` | HTTP 璺敱娌℃湁 agent 涓婁笅鏂?| 鏀逛负 `ctx.sessions.get` + `ctx.workingDirectory.get` |
| 3 | 缂撳瓨璺緞 `<etag>/<key>` | 璺緞杩囬暱/鍚屽悕鍐茬獊 | 鏀逛负 `<etag>/<sha1>-<basename>` + meta |
| 4 | 鍦板潃鐩存帴鎷?key | 鐗规畩瀛楃鐮村潖瑙ｆ瀽 | 鎸夋 percent-encode |
| 5 | 銆屽悓涓€涓晶鏍忔墦寮€銆?| 棰勮鏄嫭绔?tab | 鏄庣‘鏂板紑棰勮 tab |
| 6 | guide 鏃犲懡浠?| 鍏ュ彛涓嶅彲鐢?| 娉ㄥ唽 `cos.files` 鍛戒护 |
| 7 | `priority` 鏈鏄?| 涓庡唴缃?band 鍐茬獊 | 鏄庣‘ `extension` |
| 8 | 鏂囨湰棰勮纭紪鐮?512 KB | 涓庡彲閰嶇疆涓婇檺涓嶄竴鑷?| `min(512KB, maxPreviewBytes)` |
| 9 | 鏃犳墿灞曞悕鏂囦欢 | 鏃犳硶閫夋覆鏌撳櫒 | content-type 鏄犲皠鎵╁睍鍚?|
| 10 | 骞跺彂鐗╁寲 | 閲嶅涓嬭浇 | in-flight 鍗曢 |
| 11 | 娓呯悊鑼冨洿妯＄硦 | 璇垹鐢ㄦ埛鏂囦欢 | 鍙鐞?`.cos-cache` 涓庡甫 meta 鐨勬潯鐩?|
| 12 | `sessionId` 鏉ユ簮 | 鏈‘璁?| 妲戒綅娉ㄥ叆宸茬‘璁?|

### 绗?3 鐗堜慨姝?
| # | 鍘熸柟妗?| 闂 | 淇 |
| --- | --- | --- | --- |
| 1 | 姣忎釜浼氳瘽鍚勮嚜涓嬭浇鍒?`<workspace>/.cos-cache` | 鍏ㄥ眬妗堕噸澶嶄笅杞斤紝娴垂甯﹀涓庣鐩?| 鏀逛负鍏ㄥ眬缂撳瓨 `$DSH_HOME/cache/cos-preview`锛屼笅杞戒竴娆?|
| 2 | 宸ヤ綔鍖哄繀椤绘斁瀹屾暣鍓湰 | 涓庛€屽叏灞€缂撳瓨銆嶇洰鏍囧啿绐?| 宸ヤ綔鍖哄彧鏀剧‖閾炬帴锛涜法鍗峰洖閫€澶嶅埗 |
| 3 | 鏃犲畾鏃舵竻鐞?| 缂撳瓨鍙涓嶅噺 | `ctx.setInterval` 瀹氭椂浠诲姟 + 鍚姩娓呯悊锛孴TL/瀹归噺鍙岀瓥鐣?|
| 4 | `/tmp` | Windows 涓嶅瓨鍦?| 缂撳瓨鏍规斁 DSH_HOME锛屽彲鐢ㄦ彃浠堕厤缃鐩?|
| 5 | 娓呯悊涓庣墿鍖栧苟鍙?| 鍙兘鍒犳帀姝ｅ湪鍐欑殑鏂囦欢 | 鍚屼竴鎶婅繘绋嬪唴閿?+ 24 灏忔椂璁块棶淇濇姢 |

