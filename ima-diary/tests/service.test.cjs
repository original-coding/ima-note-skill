'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { DiaryService } = require('../scripts/lib/service.cjs');
const { createImaClient } = require('../scripts/lib/ima.cjs');
const { DiaryError } = require('../scripts/lib/errors.cjs');
const { withFakeIma } = require('./helpers/workspace.cjs');

const NOW = new Date('2026-10-28T11:48:00.000Z'); // 北京时间 2026-10-28 19:48

function makeService(env, { config, warn = () => {}, now = NOW } = {}) {
  return new DiaryService({
    call: createImaClient({ env }).call,
    config: config || { folder: '日记', timeZone: 'Asia/Shanghai' },
    now,
    warn,
    env,
  });
}

test('write 首次新建当天笔记', async () => {
  await withFakeIma(async ({ server, env }) => {
    const service = makeService(env);
    const result = await service.write({ date: '2026-10-28', time: '19:48', content: '今天跑通了日记 skill' });

    assert.equal(result.created, true);
    assert.equal(result.noteId, 'note_1');
    assert.equal(server.notes.length, 1);
    assert.equal(server.notes[0].title, '2026-10-28');
    assert.equal(server.notes[0].folder_id, 'folder_diary');
    assert.match(server.notes[0].content, /^# 2026-10-28\n\n## 19:48\n\n今天跑通了日记 skill\n$/);
  });
});

test('write 同一天第二次记录追加而不是新建', async () => {
  await withFakeIma(async ({ server, env }) => {
    const service = makeService(env);
    await service.write({ date: '2026-10-28', time: '08:10', content: '早上跑步 5 公里' });
    const second = await service.write({ date: '2026-10-28', time: '21:05', content: '晚上看完了《长安的荔枝》' });

    assert.equal(second.created, false);
    assert.equal(server.notes.length, 1);
    const content = server.notes[0].content;
    assert.match(content, /## 08:10\n\n早上跑步 5 公里/);
    assert.match(content, /## 21:05\n\n晚上看完了《长安的荔枝》/);
  });
});

test('write 支持心情、天气、标签', async () => {
  await withFakeIma(async ({ server, env }) => {
    const service = makeService(env);
    await service.write({
      date: '2026-10-28',
      time: '19:48',
      content: '写完日记',
      weather: '晴',
      mood: '平静',
      tags: ['工作', '#运动'],
    });
    assert.match(server.notes[0].content, /> 天气：晴 · 心情：平静 · #工作 #运动/);
  });
});

test('dry-run 不产生任何写请求，只返回预览', async () => {
  await withFakeIma(async ({ server, env }) => {
    const service = makeService(env);
    const result = await service.write({ date: '2026-10-28', time: '19:48', content: '预览内容', dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(result.wouldCreate, true);
    assert.match(result.markdown, /^# 2026-10-28/);
    assert.equal(server.requests.filter((req) => /import_doc|append_doc/.test(req.api)).length, 0);
  });
});

test('read 读取正文，未写的日期返回 found=false', async () => {
  await withFakeIma(async ({ env }) => {
    const service = makeService(env);
    await service.write({ date: '2026-10-28', time: '19:48', content: '今天的正文' });

    const found = await service.read('2026-10-28');
    assert.equal(found.found, true);
    assert.match(found.content, /今天的正文/);

    const missing = await service.read('2026-10-20');
    assert.equal(missing.found, false);
  });
});

test('list 标出区间内哪些天写了', async () => {
  await withFakeIma(async ({ env }) => {
    const service = makeService(env);
    await service.write({ date: '2026-10-27', time: '09:00', content: '昨天' });
    await service.write({ date: '2026-10-28', time: '19:48', content: '今天' });

    const result = await service.list({ from: '2026-10-22', to: '2026-10-28' });
    assert.equal(result.days.length, 7);
    assert.equal(result.writtenDays, 2);
    assert.deepEqual(result.missingDays, [
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
  });
});

test('search 在日记正文中检索', async () => {
  await withFakeIma(async ({ env }) => {
    const service = makeService(env);
    await service.write({ date: '2026-10-26', time: '07:00', content: '晨跑 5 公里，状态不错' });
    await service.write({ date: '2026-10-28', time: '19:48', content: '晚上整理书架' });

    const result = await service.search('晨跑');
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0].date, '2026-10-26');
  });
});

test('review 汇总区间内的正文 Markdown', async () => {
  await withFakeIma(async ({ env }) => {
    const service = makeService(env);
    await service.write({ date: '2026-10-27', time: '09:00', content: '昨天的事' });
    await service.write({ date: '2026-10-28', time: '19:48', content: '今天的事' });

    const result = await service.review({ from: '2026-10-22', to: '2026-10-28' });
    assert.equal(result.entries.length, 2);
    assert.match(result.markdown, /## 2026-10-27 周二/);
    assert.match(result.markdown, /## 2026-10-28 周三/);
    assert.match(result.markdown, /今天的事/);
    // 区间小标题已带日期，正文里的 # 日期 不应重复出现
    assert.doesNotMatch(result.markdown, /^# 2026-10-28$/m);
  });
});

test('export 按年月日命名写出本地文件，默认不覆盖', async () => {
  await withFakeIma(async ({ env, dir }) => {
    const service = makeService(env);
    await service.write({ date: '2026-10-27', time: '09:00', content: '昨天的事' });
    await service.write({ date: '2026-10-28', time: '19:48', content: '今天的事' });

    const outDir = path.join(dir, 'export');
    const first = await service.exportToDir({ from: '2026-10-22', to: '2026-10-28' }, outDir);
    assert.deepEqual(first.written, ['2026-10-27', '2026-10-28']);
    assert.equal(
      fs.readFileSync(path.join(outDir, '2026-10-28.md'), 'utf8'),
      '# 2026-10-28\n\n## 19:48\n\n今天的事\n',
    );
    assert.deepEqual(first.empty.length, 5);

    const second = await service.exportToDir({ from: '2026-10-22', to: '2026-10-28' }, outDir);
    assert.deepEqual(second.skipped, ['2026-10-27', '2026-10-28']);
    assert.deepEqual(second.written, []);

    const forced = await service.exportToDir({ from: '2026-10-22', to: '2026-10-28' }, outDir, { force: true });
    assert.deepEqual(forced.written, ['2026-10-27', '2026-10-28']);
  });
});

test('配置的笔记本不存在时拒绝写入，不会落到别处', async () => {
  await withFakeIma(async ({ server, env }) => {
    const service = makeService(env, {
      config: { folder: '不存在的笔记本', timeZone: 'Asia/Shanghai' },
    });

    await assert.rejects(
      () => service.write({ date: '2026-10-28', time: '19:48', content: '不能写到别处' }),
      (error) => {
        assert.ok(error instanceof DiaryError);
        assert.equal(error.code, -100);
        assert.match(error.message, /未找到名为「不存在的笔记本」的笔记本/);
        return true;
      },
    );
    assert.equal(server.notes.length, 0);
  });
});

test('同一笔记本内出现重复日记时静默选最早的一篇', async () => {
  await withFakeIma(async ({ server, env }) => {
    server.state.notes.push(
      {
        note_id: 'note_late',
        title: '2026-10-28',
        content: '# 2026-10-28\n\n后建的那篇',
        folder_id: 'folder_diary',
        create_time: 30,
        modify_time: 31,
        summary: '',
      },
      {
        note_id: 'note_early',
        title: '2026-10-28',
        content: '# 2026-10-28\n\n先建的那篇',
        folder_id: 'folder_diary',
        create_time: 10,
        modify_time: 11,
        summary: '',
      },
    );

    const warnings = [];
    const service = makeService(env, { warn: (message) => warnings.push(message) });
    const note = await service.findNote('2026-10-28');

    assert.equal(note.note_id, 'note_early');
    assert.equal(warnings.length, 0, '重复笔记不应再向用户告警');
  });
});

test('配置笔记本之外的同名笔记不会被读取或追加', async () => {
  await withFakeIma(async ({ server, env }) => {
    server.state.notes.push({
      note_id: 'note_outside',
      title: '2026-10-28',
      content: '# 2026-10-28\n\n外部同名笔记',
      folder_id: 'folder_work',
      create_time: 1,
      modify_time: 2,
      summary: '',
    });

    const service = makeService(env);
    const result = await service.write({ date: '2026-10-28', time: '19:48', content: '日记内容' });

    assert.equal(result.created, true);
    assert.equal(server.notes.length, 2);
    assert.equal(server.notes[1].folder_id, 'folder_diary');
    assert.match(server.notes[1].content, /日记内容/);
  });
});

test('后端业务错误按 code/msg 抛出', async () => {
  await withFakeIma(async ({ server, env }) => {
    server.state.failImport = { code: 100009, msg: '单篇笔记超过最大限制' };
    const service = makeService(env);

    await assert.rejects(
      () => service.write({ date: '2026-10-28', time: '19:48', content: '太长了' }),
      (error) => {
        assert.ok(error instanceof DiaryError);
        assert.equal(error.code, 100009);
        assert.match(error.message, /超过最大限制/);
        return true;
      },
    );
  });
});

test('上游要求更新时抛出 -200 而不是写入', async () => {
  await withFakeIma(
    async ({ server, env }) => {
      const service = makeService(env);
      await assert.rejects(
        () => service.write({ date: '2026-10-28', time: '19:48', content: '不该写到远端' }),
        (error) => {
          assert.equal(error.code, -200);
          return true;
        },
      );
      assert.equal(server.requests.filter((req) => /import_doc|append_doc/.test(req.api)).length, 0);
    },
    { latestVersion: '9.9.9' },
  );
});

test('check 能读到凭证与「日记」笔记本', async () => {
  await withFakeIma(async ({ env }) => {
    const service = makeService(env);
    const result = await service.check();

    assert.equal(result.credentials, 'ok');
    assert.equal(result.folder, '日记');
    assert.equal(result.folderFound, true);
    assert.equal(result.imaSkill.version, '1.1.10');
    assert.ok(result.notebooks.some((item) => item.name === '日记'));
  });
});

test('标题带后缀的笔记不算当天日记，静默新建纯日期笔记', async () => {
  await withFakeIma(async ({ server, env }) => {
    server.state.notes.push({
      note_id: 'note_legacy',
      title: '2026-10-28 日记',
      content: '# 2026-10-28 日记\n\n旧格式内容',
      folder_id: 'folder_diary',
      create_time: 1,
      modify_time: 2,
      summary: '',
    });

    const warnings = [];
    const service = makeService(env, { warn: (message) => warnings.push(message) });
    const result = await service.write({ date: '2026-10-28', time: '19:48', content: '新格式内容' });

    assert.equal(result.created, true);
    assert.equal(server.notes.length, 2);
    assert.equal(server.notes[1].title, '2026-10-28');
    assert.equal(warnings.length, 0, '带后缀的旧笔记不应触发提示');
  });
});

test('搜索索引延迟时，同一天第二次写入仍然追加', async () => {
  await withFakeIma(async ({ server, env }) => {
    // 模拟 IMA 的最终一致搜索：新建笔记在 60s 内搜不到，但 list_note 立即可见
    server.state.searchLagMs = 60000;

    const first = makeService(env);
    await first.write({ date: '2026-10-28', time: '20:24', content: '第一条' });

    const second = makeService(env); // 新的进程，模拟第二次 CLI 调用
    const result = await second.write({ date: '2026-10-28', time: '20:25', content: '第二条' });

    assert.equal(result.created, false);
    assert.equal(server.state.notes.length, 1);
    assert.match(server.state.notes[0].content, /## 20:24/);
    assert.match(server.state.notes[0].content, /## 20:25/);
  });
});
