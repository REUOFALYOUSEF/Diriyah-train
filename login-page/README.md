# Login Page Project

This project is a simple login page that includes a login feature with Google authentication. It is built using React and TypeScript.

## Project Structure

```
login-page
├── src
│   ├── components
│   │   ├── LoginForm.tsx
│   │   └── GoogleAuthButton.tsx
│   ├── services
│   │   └── auth.ts
│   ├── App.tsx
│   └── index.tsx
├── package.json
├── tsconfig.json
└── README.md
```

## Features

- User login with email and password.
- Google authentication integration.
- Responsive design.

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```
   cd login-page
   ```
3. Install the dependencies:
   ```
   npm install
   ```

## Firebase Cloud Setup (Public Database/Auth)

1. Create a Firebase project in Firebase Console.
2. In Authentication, enable:
   - Email/Password
   - Google
3. In Project Settings > General > Your apps, create a Web app and copy the config.
4. Create a `.env` file in the `login-page` folder using `.env.example` as a template.
5. Paste your Firebase values into `.env`:
   ```
   REACT_APP_FIREBASE_API_KEY=...
   REACT_APP_FIREBASE_AUTH_DOMAIN=...
   REACT_APP_FIREBASE_PROJECT_ID=...
   REACT_APP_FIREBASE_STORAGE_BUCKET=...
   REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...
   REACT_APP_FIREBASE_APP_ID=...
   ```

## Usage

To start the development server, run:
```
npm start
```

Open your browser and go to `http://localhost:3000` to view the application.

## Authentication

This project uses Firebase for Google authentication. Make sure to set up a Firebase project and enable Google sign-in in the Firebase console. Update the `auth.ts` service with your Firebase configuration.

## License

This project is licensed under the MIT License.