'use client';

import { useState, useEffect } from 'react';
import { db } from '../app/lib/firebase';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';

const getLocalYMD = (dateObj) => {
  const offset = dateObj.getTimezoneOffset() * 60000;
  return (new Date(dateObj - offset)).toISOString().split('T')[0];
};

export default function Journal({ user }) {
  const [entryText, setEntryText] = useState('');
  const [language, setLanguage] = useState('en');
  const [isSaving, setIsSaving] = useState(false);
  const [savedStatus, setSavedStatus] = useState('');
  const [monthEntries, setMonthEntries] = useState(new Set());

  const [adviceScope, setAdviceScope] = useState('today');
  const [conversation, setConversation] = useState([]); // [{ role: 'ai' | 'user', text: '...' }]
  const [cachedEntries, setCachedEntries] = useState(null);
  const [followUpText, setFollowUpText] = useState('');
  const [isGeneratingAdvice, setIsGeneratingAdvice] = useState(false);
  const [adviceError, setAdviceError] = useState('');

  const today = new Date();
  const todayStr = getLocalYMD(today);
  const docId = `${user.uid}_${todayStr}`;

  // Monday = 1 ... Sunday = 0 in JS getDay(). Week is "complete" once we reach Sunday.
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const isWeeklyUnlocked = dayOfWeek === 0;

  const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const isMonthlyUnlocked = today.getDate() === daysInCurrentMonth;

  // Figure out the next unlock date for each, for the tooltip text
  const getNextSunday = () => {
    const d = new Date(today);
    const daysUntilSunday = (7 - dayOfWeek) % 7 || 7;
    d.setDate(d.getDate() + (dayOfWeek === 0 ? 0 : daysUntilSunday));
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  };

  const getLastDayOfMonthLabel = () => {
    const d = new Date(today.getFullYear(), today.getMonth(), daysInCurrentMonth);
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  };

  useEffect(() => {
    const fetchTodayEntry = async () => {
      const docRef = doc(db, 'entries', docId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setEntryText(docSnap.data().text);
        setLanguage(docSnap.data().language || 'en');
      }
    };

    const fetchMonthStreak = async () => {
      const now = new Date();
      const startOfMonth = getLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1));
      const endOfMonth = getLocalYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));

      const entriesRef = collection(db, 'entries');
      const q = query(
        entriesRef,
        where('userId', '==', user.uid),
        where('date', '>=', startOfMonth),
        where('date', '<=', endOfMonth)
      );

      const querySnapshot = await getDocs(q);
      const daysWithEntries = new Set();
      querySnapshot.forEach((doc) => {
        daysWithEntries.add(doc.data().date);
      });
      setMonthEntries(daysWithEntries);
    };

    fetchTodayEntry();
    fetchMonthStreak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid, docId]);

  const handleSave = async () => {
    setIsSaving(true);
    setSavedStatus('');
    try {
      const entryData = {
        userId: user.uid,
        date: todayStr,
        text: entryText,
        language: language,
        updatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'entries', docId), entryData);
      setMonthEntries(prev => new Set(prev).add(todayStr));
      setSavedStatus('Saved!');
      setTimeout(() => setSavedStatus(''), 2000);
    } catch (error) {
      console.error(error);
      setSavedStatus('Error saving');
    }
    setIsSaving(false);
  };

  const handleScopeSelect = (scope) => {
    if (scope === 'weekly' && !isWeeklyUnlocked) return;
    if (scope === 'monthly' && !isMonthlyUnlocked) return;
    setAdviceScope(scope);
  };

  const gatherEntriesForScope = async () => {
    let targetEntries = [];

    if (adviceScope === 'today') {
      if (!entryText.trim()) {
        return { error: "Please write something in today's entry first before leveling up!" };
      }
      targetEntries = [{ date: todayStr, text: entryText }];
    } else {
      const entriesRef = collection(db, 'entries');
      let startDateStr = '';

      if (adviceScope === 'weekly') {
        const monday = new Date(today);
        const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
        monday.setDate(today.getDate() + diffToMonday);
        startDateStr = getLocalYMD(monday);
      } else if (adviceScope === 'monthly') {
        startDateStr = getLocalYMD(new Date(today.getFullYear(), today.getMonth(), 1));
      }

      const q = query(
        entriesRef,
        where('userId', '==', user.uid),
        where('date', '>=', startDateStr),
        where('date', '<=', todayStr)
      );

      const querySnapshot = await getDocs(q);
      querySnapshot.forEach((doc) => {
        if (doc.data().date === todayStr && entryText.trim()) {
          targetEntries.push({ date: todayStr, text: entryText });
        } else {
          targetEntries.push({ date: doc.data().date, text: doc.data().text });
        }
      });

      if (!targetEntries.some(e => e.date === todayStr) && entryText.trim()) {
        targetEntries.push({ date: todayStr, text: entryText });
      }
    }

    if (targetEntries.length === 0) {
      return { error: "You don't have any journal entries saved for this time range. Try writing a bit more first!" };
    }

    return { entries: targetEntries };
  };

  const handleStartLevelUp = async () => {
    if (adviceScope === 'weekly' && !isWeeklyUnlocked) return;
    if (adviceScope === 'monthly' && !isMonthlyUnlocked) return;

    setIsGeneratingAdvice(true);
    setAdviceError('');
    setConversation([]);
    setCachedEntries(null);

    try {
      const result = await gatherEntriesForScope();
      if (result.error) {
        setAdviceError(result.error);
        setIsGeneratingAdvice(false);
        return;
      }

      const targetEntries = result.entries;
      setCachedEntries(targetEntries);

      const response = await fetch('/api/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: adviceScope,
          entries: targetEntries,
          language: language,
          history: []
        })
      });

      const data = await response.json();
      if (response.ok) {
        setConversation([{ role: 'ai', text: data.advice }]);
      } else {
        setAdviceError(data.error || 'Something went wrong processing your request.');
      }
    } catch (err) {
      console.error(err);
      setAdviceError('Network error connecting to AI endpoint.');
    }
    setIsGeneratingAdvice(false);
  };

  const handleSendFollowUp = async () => {
    if (!followUpText.trim() || !cachedEntries) return;

    const newUserMessage = { role: 'user', text: followUpText };
    const updatedConversation = [...conversation, newUserMessage];
    setConversation(updatedConversation);
    setFollowUpText('');
    setIsGeneratingAdvice(true);
    setAdviceError('');

    try {
      const response = await fetch('/api/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: adviceScope,
          entries: cachedEntries,
          language: language,
          history: conversation,
          userMessage: newUserMessage.text
        })
      });

      const data = await response.json();
      if (response.ok) {
        setConversation(prev => [...prev, { role: 'ai', text: data.advice }]);
      } else {
        setAdviceError(data.error || 'Something went wrong processing your request.');
      }
    } catch (err) {
      console.error(err);
      setAdviceError('Network error connecting to AI endpoint.');
    }
    setIsGeneratingAdvice(false);
  };

  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = getLocalYMD(new Date(today.getFullYear(), today.getMonth(), day));
    return { day, dateStr, hasEntry: monthEntries.has(dateStr), isToday: dateStr === todayStr };
  });

  return (
    <div className="w-full max-w-3xl flex flex-col gap-8">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <h3 className="text-sm font-medium text-slate-400 mb-4 uppercase tracking-wider">This Month's Streak</h3>
        <div className="flex flex-wrap gap-2">
          {daysArray.map(({ day, dateStr, hasEntry, isToday }) => (
            <div
              key={day}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors
                ${hasEntry ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-400'}
                ${isToday && !hasEntry ? 'ring-2 ring-blue-300 ring-offset-2' : ''}
              `}
            >
              {day}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-semibold text-slate-800">Today's Entry</h2>
            <p className="text-slate-500">{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>

          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 focus:outline-none focus:border-blue-500"
          >
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="hinglish">Hinglish</option>
          </select>
        </div>

        <textarea
          value={entryText}
          onChange={(e) => setEntryText(e.target.value)}
          placeholder="What's on your mind today?"
          className="w-full h-64 p-4 mt-2 bg-slate-50 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-slate-700 leading-relaxed"
        />

        <div className="flex justify-end items-center gap-4 mt-2">
          <span className="text-sm text-emerald-600 font-medium">{savedStatus}</span>
          <button
            onClick={handleSave}
            disabled={isSaving || !entryText.trim()}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-full font-medium transition-colors shadow-sm"
          >
            {isSaving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Level Up</h3>
            <p className="text-sm text-slate-400">Select a reflection lens and start a session</p>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
            {['today', 'weekly', 'monthly'].map((scope) => {
              const locked = (scope === 'weekly' && !isWeeklyUnlocked) || (scope === 'monthly' && !isMonthlyUnlocked);
              const label = scope === 'today' ? 'Today' : scope === 'weekly' ? '7 Days' : 'This Month';
              const tooltip = scope === 'weekly'
                ? `Unlocks Sunday (${getNextSunday()}), once the week's complete`
                : scope === 'monthly'
                  ? `Unlocks ${getLastDayOfMonthLabel()}, once the month's complete`
                  : '';

              return (
                <button
                  key={scope}
                  onClick={() => handleScopeSelect(scope)}
                  disabled={isGeneratingAdvice || locked}
                  title={locked ? tooltip : ''}
                  className={`px-4 py-2 text-xs font-medium uppercase tracking-wider rounded-lg transition-all flex items-center gap-1
                    ${adviceScope === scope ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}
                    ${locked ? 'opacity-50 cursor-not-allowed' : 'hover:text-slate-800'}
                  `}
                >
                  {locked && <span className="text-[10px]">🔒</span>}
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {((adviceScope === 'weekly' && !isWeeklyUnlocked) || (adviceScope === 'monthly' && !isMonthlyUnlocked)) && (
          <div className="text-xs text-slate-400 -mt-2">
            {adviceScope === 'weekly'
              ? `This unlocks on Sunday (${getNextSunday()}), once the current week wraps up.`
              : `This unlocks on ${getLastDayOfMonthLabel()}, the last day of the month.`}
          </div>
        )}

        <button
          onClick={handleStartLevelUp}
          disabled={isGeneratingAdvice || (adviceScope === 'weekly' && !isWeeklyUnlocked) || (adviceScope === 'monthly' && !isMonthlyUnlocked)}
          className="w-full py-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-xl font-medium tracking-wide transition-colors shadow-sm"
        >
          {isGeneratingAdvice && conversation.length === 0 ? 'Reading your entries...' : conversation.length > 0 ? 'Restart Level Up' : 'Level Up'}
        </button>

        {adviceError && (
          <div className="p-4 bg-rose-50 text-rose-600 rounded-xl text-sm border border-rose-100">
            {adviceError}
          </div>
        )}

        {conversation.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-blue-600 font-medium text-sm tracking-wide uppercase">
              <span>✨</span> Level Up ({adviceScope})
            </div>

            <div className="flex flex-col gap-3 max-h-[28rem] overflow-y-auto pr-1">
              {conversation.map((msg, i) => (
                msg.role === 'ai' ? (
                  <div key={i} className="bg-blue-50/50 border border-blue-100/50 rounded-2xl rounded-tl-sm p-4 text-slate-700 leading-relaxed self-start max-w-[90%]">
                    <div className="flex flex-col gap-2">
                      {msg.text
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0)
                        .map((line, j) => (
                          <p key={j}>{line}</p>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="bg-slate-900 text-white rounded-2xl rounded-tr-sm p-4 leading-relaxed self-end max-w-[90%]">
                    <p>{msg.text}</p>
                  </div>
                )
              ))}

              {isGeneratingAdvice && conversation.length > 0 && (
                <div className="bg-blue-50/50 border border-blue-100/50 rounded-2xl rounded-tl-sm p-4 text-slate-400 text-sm self-start">
                  Typing...
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={followUpText}
                onChange={(e) => setFollowUpText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isGeneratingAdvice && followUpText.trim()) {
                    handleSendFollowUp();
                  }
                }}
                placeholder="Reply..."
                disabled={isGeneratingAdvice}
                className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-slate-700 disabled:bg-slate-100"
              />
              <button
                onClick={handleSendFollowUp}
                disabled={isGeneratingAdvice || !followUpText.trim()}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium transition-colors shadow-sm"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}