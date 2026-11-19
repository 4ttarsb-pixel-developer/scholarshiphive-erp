import { Link } from 'react-router-dom';
import { Card } from '../components/ui.jsx';

export default function Privacy({ publicView }) {
  return (
    <>
      <div className="page-head"><div><h1>Privacy Policy</h1><p>ScholarshipHive ERP · Last updated October 2026</p></div>{publicView && <Link className="btn" to="/login">Back to login</Link>}</div>
      <Card>
        <div className="prose">
          <p>This policy explains how ScholarshipHive Edutancy (SMC-Private) Limited (“ScholarshipHive”, “we”) collects, uses and protects information inside the ScholarshipHive ERP staff portal (“the ERP”). The ERP is an internal system for employees and administrators only.</p>

          <h2>1. Information we collect</h2>
          <ul>
            <li><b>Employee registration:</b> full name, father name, CNIC number, two contact numbers, current and permanent address, profile picture, CV, education details, uploaded documents, and optional information you choose to give (family background, reason for leaving last job, about note).</li>
            <li><b>Account data:</b> your Google-verified email address, a securely hashed password (we never store or see your actual password), theme and font preferences.</li>
            <li><b>Work records:</b> sales and payments recorded against you, salary terms, commission, bonuses, deductions, salary slips, expenses and petty cash entries you create, receipts you upload, announcement replies and requests you send to admin.</li>
            <li><b>Security logs:</b> login time, IP address, browser type and an activity log of important actions (who changed what and when).</li>
          </ul>

          <h2>2. Why we use it</h2>
          <ul>
            <li>To verify your identity and approve your account.</li>
            <li>To calculate and pay salaries and sales commission, and to issue salary slips.</li>
            <li>To keep accurate company accounts (revenue, expenses, petty cash, assets, liabilities, cash flow).</li>
            <li>To send automatic emails about your account, access, salary and company announcements.</li>
            <li>To protect the system against misuse and to keep an audit trail.</li>
          </ul>

          <h2>3. Who can see your information</h2>
          <ul>
            <li><b>You</b> can always see your own salary, sales and salary slips.</li>
            <li><b>Admins</b> (maximum three, including the Super Admin) can see all records.</li>
            <li><b>Other employees</b> can only open the pages an admin has approved for them (for example an accountant may be given access to salary or expense pages). Your CNIC, documents and CV are only visible to admins and staff with “User Management” access.</li>
            <li>Your name, employee ID and profile picture are visible to colleagues inside the ERP (for example in announcements and sales lists).</li>
            <li>We do not sell or share your information with advertisers. Information is shared outside ScholarshipHive only when required by law (e.g. tax or labour authorities) or with your consent.</li>
          </ul>

          <h2>4. Google sign-in</h2>
          <p>We use Google OAuth only to confirm that your email address belongs to you and to let you log in. We receive your name, email address and Google account ID. We do not access your Gmail, Drive, contacts or any other Google data.</p>

          <h2>5. Security</h2>
          <ul>
            <li>Passwords must be at least 12 characters with capital and small letters, numbers and a special character, and are stored only as secure hashes.</li>
            <li>Every session ends automatically after 30 minutes of inactivity.</li>
            <li>Uploaded files are checked to make sure they are genuine images, PDFs or Word documents; duplicate receipts are flagged.</li>
            <li>Access to every page is controlled by roles that only admins can grant.</li>
          </ul>

          <h2>6. How long we keep information</h2>
          <p>Employee and financial records are kept for as long as needed for accounting, tax and legal purposes. Salary records that are approved or paid cannot be deleted, so the company’s accounts remain correct; an account can be blocked instead. Rejected registrations may be deleted by an admin.</p>

          <h2>7. Your rights</h2>
          <p>You can view your own records at any time, update your password and preferences in My Settings, and ask admin (Settings → Requests to Admin) to correct your personal details. If you leave the company, your login is blocked; financial records linked to you are kept as required by law.</p>

          <h2>8. Contact</h2>
          <p>For any privacy question, contact the ScholarshipHive administration (see the Owner Information page inside the ERP).</p>
        </div>
      </Card>
    </>
  );
}
