'use client';

import { useId, useState } from 'react';
import type { ThinkKnownIdentity, ThinkPresentationActions, ThinkQuestion as Question } from './types';

interface QuestionProps {
  identity: ThinkKnownIdentity;
  question: Question;
  actions: ThinkPresentationActions;
  canReply?: boolean;
}

/** Only ordinary, session-owned questions enter this component. Never approvals. */
export default function ThinkQuestion({ identity, question, actions, canReply = true }: QuestionProps) {
  const id = useId();
  const [validation, setValidation] = useState('');
  const detail = question.detail;
  const answer = { ...question.answer };
  for (const field of detail.fields) {
    if (answer[field.key] === undefined && field.default !== undefined) answer[field.key] = field.default;
  }
  const fields = detail.fields.filter(field => !field.hidden && (!field.when || field.when.every(rule => rule.op === 'eq' ? answer[rule.key] === rule.value : answer[rule.key] !== rule.value)));
  const settled = question.reply === 'replied' || question.reply === 'stale';
  const pending = question.reply === 'registered' || question.reply === 'upstream-unconfirmed';
  const edit = (key: string, value: string | number | boolean | readonly string[] | undefined) => {
    const next = { ...answer };
    if (value === undefined) delete next[key]; else next[key] = value;
    setValidation('');
    actions.editQuestion(identity, question.decisionId, next);
  };

  return <section className="think-question" aria-labelledby={`${id}-title`}>
    <p className="think-role">AI question</p>
    <h2 id={`${id}-title`}>{detail.title}</h2>
    <form onSubmit={event => {
      event.preventDefault();
      if (pending || settled || !canReply) return;
      for (const field of fields) {
        if (field.type !== 'multiselect') continue;
        const selected = answer[field.key];
        const count = Array.isArray(selected) ? selected.length : 0;
        if (count < (field.minItems ?? (field.required ? 1 : 0)) || (field.maxItems !== undefined && count > field.maxItems)) {
          setValidation(`Choose the requested number of answers for ${field.title || field.key}.`);
          return;
        }
      }
      actions.replyQuestion(identity, question.decisionId, answer);
    }}>
      <fieldset disabled={pending || settled} className="think-question-fields" aria-labelledby={`${id}-title`}>
        {fields.map((field, index) => {
          const fieldId = `${id}-field-${index}`;
          const description = field.description ? `${fieldId}-description` : undefined;
          const title = `${field.title || field.key}${field.required ? ' (required)' : ''}`;
          const value = answer[field.key];
          const help = field.description && <p id={description} className="think-field-description">{field.description}</p>;
          if (field.type === 'boolean') return <fieldset className="think-question-group" key={field.key}>
            <legend>{title}</legend>{help}
            {[true, false].map(choice => <label className="think-choice" key={String(choice)}>
              <input type="radio" name={fieldId} checked={value === choice} required={field.required} aria-describedby={description} onChange={() => edit(field.key, choice)} />{choice ? 'Yes' : 'No'}
            </label>)}
          </fieldset>;
          if (field.type === 'multiselect') {
            const selected = Array.isArray(value) ? value : [];
            const custom = selected.filter(item => !field.options.some(option => option.value === item));
            return <fieldset className="think-question-group" key={field.key}>
              <legend>{title}</legend>{help}
              {field.options.map(option => <label className="think-choice" key={option.value}>
                <input type="checkbox" checked={selected.includes(option.value)} aria-describedby={description} onChange={event => edit(field.key, event.target.checked ? [...selected, option.value] : selected.filter(item => item !== option.value))} />
                <span>{option.label}{option.description && <span className="think-option-description">{option.description}</span>}</span>
              </label>)}
              {field.custom && <label className="think-field">Other answers (one per line)
                <textarea rows={2} value={custom.join('\n')} onChange={event => edit(field.key, [...selected.filter(item => field.options.some(option => option.value === item)), ...event.target.value.split('\n')])} />
              </label>}
            </fieldset>;
          }
          return <div className="think-field" key={field.key}>
            <label htmlFor={fieldId}>{title}</label>{help}
            {field.type === 'string' ? field.options && !field.custom
              ? <select id={fieldId} required={field.required} aria-describedby={description} value={typeof value === 'string' ? value : ''} onChange={event => edit(field.key, event.target.value)}>
                <option value="">Choose an answer</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              : <><input id={fieldId} type={field.format === 'email' ? 'email' : field.format === 'uri' ? 'url' : field.format === 'date' ? 'date' : 'text'}
                list={field.options ? `${fieldId}-options` : undefined} value={typeof value === 'string' ? value : ''} required={field.required}
                minLength={field.minLength} maxLength={field.maxLength} pattern={field.pattern} placeholder={field.placeholder} aria-describedby={description}
                onChange={event => edit(field.key, event.target.value)} />
                {field.options && <datalist id={`${fieldId}-options`}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>}</>
              : <input id={fieldId} type="number" value={typeof value === 'number' ? value : ''} required={field.required}
                step={field.type === 'integer' ? 1 : 'any'} min={typeof field.minimum === 'number' ? field.minimum : undefined} max={typeof field.maximum === 'number' ? field.maximum : undefined}
                aria-describedby={description} onChange={event => edit(field.key, Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : undefined)} />}
          </div>;
        })}
      </fieldset>
      {validation && <p className="think-exception" role="alert">{validation}</p>}
      {settled ? <p className="think-exception">This question was already answered or changed.</p>
        : <><button type="submit" className="think-button think-secondary" disabled={pending || !canReply}>{pending ? 'Sending answer…' : 'Send answer'}</button>
          {question.reply === 'rejected' && <p className="think-exception">The answer wasn’t accepted. Check your answers.</p>}</>}
    </form>
  </section>;
}
