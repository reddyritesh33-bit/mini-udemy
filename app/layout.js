import Nav from "./Nav";

export const metadata = { title: "Mini-Udemy" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <Nav />
        {children}
      </body>
    </html>
  );
}
