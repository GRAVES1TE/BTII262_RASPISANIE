// Automated verification of Calendar Export (.ics & Google Calendar) and Data Logic
const fs = require('fs');
const assert = require('assert');

// Mock browser environment for Schedule module
const mockLocalStorage = {};
global.localStorage = {
  getItem: (k) => mockLocalStorage[k] || null,
  setItem: (k, v) => { mockLocalStorage[k] = String(v); },
  removeItem: (k) => { delete mockLocalStorage[k]; }
};

global.document = {
  querySelectorAll: () => [],
  getElementById: (id) => ({
    textContent: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    removeChild() {},
    innerHTML: ''
  }),
  createElement: (tag) => {
    const el = {
      tag,
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      dataset: {},
      setAttribute() {},
      innerHTML: '',
      appendChild(child) {},
      removeChild(child) {},
      querySelector() { return el; },
      querySelectorAll() { return []; },
      addEventListener() {},
      click() {}
    };
    return el;
  },
  body: {
    appendChild() {},
    removeChild() {}
  }
};

global.URL = {
  createObjectURL: (b) => 'blob:mock-url',
  revokeObjectURL: () => {}
};

global.Blob = class Blob {
  constructor(parts, opts) {
    this.parts = parts;
    this.opts = opts;
    this.content = parts.join('');
  }
};

global.window = {
  App: {
    showToast() {},
    updateSyncStatus() {}
  }
};
global.App = global.window.App;

// Load schedule data
const rawData = JSON.parse(fs.readFileSync('./data/schedule.json', 'utf8'));

// Load schedule.js code
const scheduleCode = fs.readFileSync('./static/js/schedule.js', 'utf8');
eval(scheduleCode);
const Schedule = window.Schedule;

console.log('Testing Schedule module initialization...');
Schedule.rawSchedule = rawData;
Schedule.selectedSubgroup = 1;

// 1. Test .ics export for Subgroup 1
console.log('Testing exportSemesterIcs() for Subgroup 1...');
let exportedBlob = null;
global.URL.createObjectURL = (blob) => {
  exportedBlob = blob;
  return 'blob:test';
};

Schedule.exportSemesterIcs();
assert(exportedBlob, 'Exported blob must not be null');
const icsText = exportedBlob.content;

// RFC 5545 validation checks
assert(icsText.startsWith('BEGIN:VCALENDAR\r\n'), 'Must start with BEGIN:VCALENDAR');
assert(icsText.endsWith('END:VCALENDAR'), 'Must end with END:VCALENDAR');
assert(icsText.includes('PRODID:-//BTII262//Schedule Calendar//RU\r\n'), 'Must include valid PRODID');
assert(icsText.includes('X-WR-CALNAME:Расписание бТИИ-262 (1 п/г)\r\n'), 'Must include subgroup name');

// Check that no blank lines exist inside VCALENDAR
const lines = icsText.split('\r\n');
for (let i = 0; i < lines.length; i++) {
  assert(lines[i].length > 0, `Line ${i + 1} must not be blank`);
}

// Check VEVENT structure
const vevents = icsText.split('BEGIN:VEVENT').slice(1);
console.log(`Generated ${vevents.length} VEVENTs for Subgroup 1.`);
assert(vevents.length > 20, `Expected at least 20 events, got ${vevents.length}`);

vevents.forEach((v, idx) => {
  assert(v.includes('UID:'), `VEVENT ${idx} missing UID`);
  assert(v.includes('DTSTAMP:'), `VEVENT ${idx} missing DTSTAMP`);
  assert(v.includes('DTSTART:'), `VEVENT ${idx} missing DTSTART`);
  assert(v.includes('DTEND:'), `VEVENT ${idx} missing DTEND`);
  assert(v.includes('SUMMARY:'), `VEVENT ${idx} missing SUMMARY`);
  assert(v.includes('LOCATION:'), `VEVENT ${idx} missing LOCATION`);
  assert(v.includes('DESCRIPTION:'), `VEVENT ${idx} missing DESCRIPTION`);
  assert(v.includes('STATUS:CONFIRMED'), `VEVENT ${idx} missing STATUS`);
});

// Check discrete weeks for lessons with custom weeks (e.g., Foreign language on weeks 2, 6, 10, 14)
const discreteWeekEvents = vevents.filter(v => v.includes('-w2-') || v.includes('-w6-') || v.includes('-w10-') || v.includes('-w14-'));
console.log(`Found ${discreteWeekEvents.length} discrete week events.`);
assert(discreteWeekEvents.length > 0, 'Discrete week events must be emitted for lessons with weeks array');
discreteWeekEvents.forEach(v => {
  assert(!v.includes('RRULE:'), 'Discrete single-week events must NOT contain RRULE');
});

// 2. Test Subgroup 2 export
console.log('Testing exportSemesterIcs() for Subgroup 2...');
Schedule.selectedSubgroup = 2;
Schedule.exportSemesterIcs();
const icsText2 = exportedBlob.content;
assert(icsText2.includes('X-WR-CALNAME:Расписание бТИИ-262 (2 п/г)'), 'Must include 2 п/г in name');
const vevents2 = icsText2.split('BEGIN:VEVENT').slice(1);
console.log(`Generated ${vevents2.length} VEVENTs for Subgroup 2.`);
assert(vevents2.length > 20, 'Expected >20 events for Subgroup 2');

// 3. Test Google Calendar URL generation
console.log('Testing getGoogleCalendarUrl()...');
const sampleLesson = rawData.days[0].lessons[0]; // Physics lab on Monday
const gcalUrl = Schedule.getGoogleCalendarUrl(sampleLesson, 1);
assert(gcalUrl.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'), 'Must start with Google Calendar template URL');
assert(gcalUrl.includes('text='), 'Must include text');
assert(gcalUrl.includes('dates='), 'Must include dates');
assert(gcalUrl.includes('location='), 'Must include location');
assert(gcalUrl.includes('details='), 'Must include details');
assert(gcalUrl.includes('recur=RRULE'), 'Must include recurrence rule for weekly classes');
console.log('Generated GCal URL successfully:', gcalUrl.slice(0, 100) + '...');

// 4. Test escapeIcs()
console.log('Testing escapeIcs()...');
const rawStr = 'ул. 20-летия Октября, 84; Корпус 1\\Main\nLine 2';
const escapedStr = Schedule.escapeIcs(rawStr);
assert.strictEqual(escapedStr, 'ул. 20-летия Октября\\, 84\\; Корпус 1\\\\Main\\nLine 2');

// 5. Test subgroup persistence in localStorage
console.log('Testing subgroup persistence in localStorage...');
Schedule.setSubgroup(2);
assert.strictEqual(localStorage.getItem('btii_subgroup'), '2', 'localStorage must retain chosen subgroup');
Schedule.setSubgroup(1);
assert.strictEqual(localStorage.getItem('btii_subgroup'), '1', 'localStorage must update chosen subgroup');

console.log('ALL JS TESTS PASSED SUCCESSFULLY! ✅');
